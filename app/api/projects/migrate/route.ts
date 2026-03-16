import { NextRequest, NextResponse } from 'next/server';
import { Client } from 'ssh2';
import { generateExportProjectScript, generateImportProjectScript, generatePrepareServerScript } from '@/lib/project-manager';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Allow enough time for migration

export async function POST(req: NextRequest) {
    // Return a streaming response so the frontend can receive live logs
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    const writeLog = async (msg: string) => {
        await writer.write(encoder.encode(JSON.stringify({ message: msg }) + '\n'));
    };

    // Docker compose writes progress info to stderr, which is not an actual error.
    // This helper distinguishes real errors from informational docker/systemd stderr output.
    const isDockerInfoStderr = (text: string): boolean => {
        const infoPatterns = [
            /Container \S+ (Creating|Created|Starting|Started|Stopping|Stopped|Removing|Removed)/i,
            /Network \S+ (Creating|Created|Removing|Removed)/i,
            /Volume \S+ (Creating|Created|Removing|Removed)/i,
            /Synchronizing state of .+\.service/i,
            /Executing: \/usr\/lib\/systemd/i,
            /[a-f0-9]+ (Pulling|Extracting|Downloading|Pull complete|Download complete|Verifying|Waiting)/i,
            /Image .+ Pull/i,
            /Pulled\s*$/i,
        ];
        return infoPatterns.some(p => p.test(text));
    };

    /**
     * Executes a bash script on a remote server via SSH.
     * If the user is not root, uses sudo -S to escalate privileges,
     * piping the password via stdin before the script content.
     */
    const execScriptOnServer = (
        client: Client,
        script: string,
        username: string,
        password: string,
    ): Promise<{ stdout: string; stderr: string }> => {
        return new Promise((resolve, reject) => {
            const isRoot = username === 'root';
            const command = isRoot ? 'bash --login -s' : 'sudo -S bash --login -s';

            client.exec(command, (err, streamItem) => {
                if (err) return reject(err);

                let stdout = '';
                let stderr = '';

                streamItem.on('close', () => {
                    resolve({ stdout, stderr });
                }).on('data', (data: any) => {
                    stdout += data.toString();
                }).stderr.on('data', (data: any) => {
                    stderr += data.toString();
                });

                // If non-root, pipe the password first for sudo -S
                if (!isRoot) {
                    streamItem.write(password + '\n');
                }
                streamItem.write(script);
                streamItem.end();
            });
        });
    };

    const processMigration = async () => {
        let sourceClient: Client | null = null;
        let targetClient: Client | null = null;

        try {
            const body = await req.json();
            const { sourceCreds, targetCreds, projectName, projectType, newDomain } = body;

            if (!sourceCreds || !sourceCreds.host || !targetCreds || !targetCreds.host || !projectName) {
                throw new Error("Missing required credentials or project name");
            }

            // ==========================================
            // 0. Connect to Target Server (Pre-validation)
            // ==========================================
            await writeLog(`🔍 Validando credenciales del servidor de destino: ${targetCreds.host}...`);
            targetClient = new Client();
            await new Promise<void>((resolve, reject) => {
                targetClient!.on('ready', () => {
                    resolve();
                }).on('error', (err) => {
                    reject(new Error(`Credenciales de destino inválidas (${targetCreds.host}): ${err.message}`));
                }).connect({
                    host: targetCreds.host,
                    port: 22,
                    username: targetCreds.username,
                    password: targetCreds.password,
                    readyTimeout: 20000,
                });
            });
            await writeLog(`✓ Servidor de destino válido.`);

            // ==========================================
            // 0.5 Prepare Target Server (install Docker if needed)
            // ==========================================
            await writeLog(`\n🔧 Preparando servidor de destino...`);
            const isTargetRoot = targetCreds.username === 'root';
            if (!isTargetRoot) {
                await writeLog(`> 🔑 Usuario no-root detectado (${targetCreds.username}). Usando sudo para escalar privilegios...`);
            }
            const prepareScript = generatePrepareServerScript();

            await new Promise<void>((resolve, reject) => {
                const cmd = isTargetRoot ? 'bash --login -s' : 'sudo -S bash --login -s';
                targetClient!.exec(cmd, (err, streamItem) => {
                    if (err) return reject(err);

                    let hasPrepareSuccess = false;
                    streamItem.on('close', () => {
                        if (hasPrepareSuccess) resolve();
                        else reject(new Error("La preparación del servidor destino falló."));
                    }).on('data', (data: any) => {
                        const chunk = data.toString();
                        if (chunk.includes('PREPARE_SUCCESS')) {
                            hasPrepareSuccess = true;
                        }
                        const lines = chunk.split('\n');
                        for (const line of lines) {
                            if (line.trim() && !line.includes('PREPARE_SUCCESS')) {
                                writeLog(`> ${line}`);
                            }
                        }
                    }).stderr.on('data', (data: any) => {
                        const text = data.toString();
                        if (text.includes('[sudo] password') || text.includes('password for')) return;
                        if (isDockerInfoStderr(text)) {
                            writeLog(`> ${text.trim()}`);
                        } else {
                            writeLog(`[ERROR] > ${text}`);
                        }
                    });

                    // If non-root, pipe password first for sudo -S
                    if (!isTargetRoot) {
                        streamItem.write(targetCreds.password + '\n');
                    }
                    streamItem.write(prepareScript);
                    streamItem.end();
                });
            });
            await writeLog(`✓ Servidor de destino preparado.`);

            // ==========================================
            // 1. Connect to Source Server
            // ==========================================
            await writeLog(`\n🚀 [1/4] Connectando al servidor de origen: ${sourceCreds.host}...`);
            sourceClient = new Client();
            
            await new Promise<void>((resolve, reject) => {
                sourceClient!.on('ready', resolve).on('error', reject).connect({
                    host: sourceCreds.host,
                    port: 22,
                    username: sourceCreds.username,
                    password: sourceCreds.password,
                    readyTimeout: 20000,
                });
            });
            await writeLog(`[1/4] ✓ Conexión exitosa a servidor de origen.`);

            // ==========================================
            // 2. Export on Source Server
            // ==========================================
            await writeLog(`\n💾 [2/4] Ejecutando exportación en origen para proyecto: ${projectName}...`);
            const isSourceRoot = sourceCreds.username === 'root';
            if (!isSourceRoot) {
                await writeLog(`> 🔑 Usuario no-root detectado en origen (${sourceCreds.username}). Usando sudo...`);
            }
            const exportScript = generateExportProjectScript(projectName, projectType);
            
            let exportTarPath = '';

            await new Promise<void>((resolve, reject) => {
                const exportCmd = isSourceRoot ? 'bash --login -s' : 'sudo -S bash --login -s';
                sourceClient!.exec(exportCmd, (err, streamItem) => {
                    if (err) return reject(err);
                    
                    let output = '';
                    streamItem.on('close', () => {
                        try {
                            // Extract path from output (expecting EXPORT_SUCCESS|/tmp/...)
                            const match = output.match(/EXPORT_SUCCESS\|(.+)/);
                            if (match && match[1]) {
                                exportTarPath = match[1].trim();
                                resolve();
                            } else {
                                reject(new Error("No se pudo obtener la ruta del archivo exportado. Revisa los logs:\n" + output));
                            }
                        } catch (e) {
                            reject(e);
                        }
                    }).on('data', (data: any) => {
                        const chunk = data.toString();
                        output += chunk;
                        // Forward log lines
                        const lines = chunk.split('\n');
                        for (const line of lines) {
                            if (line.trim() && !line.includes('EXPORT_SUCCESS')) {
                                writeLog(`> ${line}`);
                            }
                        }
                    }).stderr.on('data', (data: any) => {
                        const text = data.toString();
                        if (text.includes('[sudo] password') || text.includes('password for')) return;
                        if (isDockerInfoStderr(text)) {
                            writeLog(`> ${text.trim()}`);
                        } else {
                            writeLog(`[ERROR] > ${text}`);
                        }
                    });
                    
                    // If non-root, pipe password first for sudo -S
                    if (!isSourceRoot) {
                        streamItem.write(sourceCreds.password + '\n');
                    }
                    streamItem.write(exportScript);
                    streamItem.end();
                });
            });

            if (!exportTarPath) throw new Error("Export path is empty.");
            await writeLog(`\n[2/4] ✓ Exportación finalizada. Archivo: ${exportTarPath}`);

            // ==========================================
            // 3. Transfer
            // ==========================================
            await writeLog(`\n🔌 [3/4] Usando conexión establecida de servidor destino: ${targetCreds.host}...`);

            const targetTarPath = `/tmp/imports/${projectName}.tar.gz`;
            
            // Create target dir if not exist (and ensure the SSH user can write to it for SFTP)
            await new Promise<void>((resolve, reject) => {
                const mkdirCmd = isTargetRoot
                    ? 'mkdir -p /tmp/imports'
                    : `echo '${targetCreds.password.replace(/'/g, "'\\''")}' | sudo -S bash -c 'mkdir -p /tmp/imports && chown ${targetCreds.username}:${targetCreds.username} /tmp/imports'`;
                targetClient!.exec(mkdirCmd, (err, s) => {
                    if (err) return reject(err);
                    s.on('close', resolve).on('data', () => {}).stderr.on('data', () => {});
                });
            });

            // Check if the tar file already exists on the target with a reasonable size (> 1KB)
            const targetFileExists = await new Promise<boolean>((resolve) => {
                const checkCmd = isTargetRoot
                    ? `stat -c '%s' ${targetTarPath} 2>/dev/null || echo 0`
                    : `sudo stat -c '%s' ${targetTarPath} 2>/dev/null || echo 0`;
                targetClient!.exec(checkCmd, (err, s) => {
                    if (err) return resolve(false);
                    let output = '';
                    s.on('close', () => {
                        const size = parseInt(output.trim(), 10);
                        resolve(size > 1024);
                    }).on('data', (data: any) => {
                        output += data.toString();
                    }).stderr.on('data', () => {});
                });
            });

            if (targetFileExists) {
                await writeLog(`\n[3/4] ✅ Archivo ya existe en destino: ${targetTarPath}. Saltando transferencia.`);
            } else {
                await writeLog(`\n[3/4] 🚀 Transfiriendo archivo exportado de origen a destino...`);

                await new Promise<void>((resolve, reject) => {
                    sourceClient!.sftp((errSource: any, sftpSource: any) => {
                        if (errSource) return reject(new Error("SFTP Error Source: " + errSource.message));
                        
                        targetClient!.sftp((errTarget: any, sftpTarget: any) => {
                            if (errTarget) return reject(new Error("SFTP Error Target: " + errTarget.message));

                            const readStream = sftpSource.createReadStream(exportTarPath);
                            const writeStream = sftpTarget.createWriteStream(targetTarPath);

                            readStream.on('error', (err: any) => reject(new Error("Read Stream Error: " + err.message)));
                            writeStream.on('error', (err: any) => reject(new Error("Write Stream Error: " + err.message)));
                            
                            writeStream.on('close', () => resolve());

                            readStream.pipe(writeStream);
                        });
                    });
                });

                await writeLog(`[3/4] ✓ Transferencia completada al destino: ${targetTarPath}`);
            }

            // ==========================================
            // 4. Import on Target Server
            // ==========================================
            await writeLog(`\n📥 [4/4] Ejecutando importación en destino para proyecto: ${projectName}...`);
            const importScript = generateImportProjectScript(projectName, projectType, newDomain);
            
            await new Promise<void>((resolve, reject) => {
                const importCmd = isTargetRoot ? 'bash --login -s' : 'sudo -S bash --login -s';
                targetClient!.exec(importCmd, (err, streamItem) => {
                    if (err) return reject(err);
                    
                    let hasSuccess = false;
                    let accessInfo = '';
                    streamItem.on('close', () => {
                        if (hasSuccess) resolve();
                        else reject(new Error("La importación no reportó éxito."));
                    }).on('data', (data: any) => {
                        const chunk = data.toString();
                        if (chunk.includes('IMPORT_SUCCESS|')) {
                            hasSuccess = true;
                            // Extract access info from IMPORT_SUCCESS line
                            const match = chunk.match(/IMPORT_SUCCESS\|([^\n]+)/);
                            if (match) accessInfo = match[1].trim();
                        }
                        const lines = chunk.split('\n');
                        for (const line of lines) {
                            if (line.trim() && !line.includes('IMPORT_SUCCESS')) {
                                writeLog(`> ${line}`);
                            }
                        }
                    }).stderr.on('data', (data: any) => {
                        const text = data.toString();
                        if (text.includes('[sudo] password') || text.includes('password for')) return;
                        if (isDockerInfoStderr(text)) {
                            writeLog(`> ${text.trim()}`);
                        } else {
                            writeLog(`[ERROR] > ${text}`);
                        }
                    });
                    
                    // If non-root, pipe password first for sudo -S
                    if (!isTargetRoot) {
                        streamItem.write(targetCreds.password + '\n');
                    }
                    streamItem.write(importScript);
                    streamItem.end();
                });
            });

            await writeLog(`\n[4/4] ✓ Importación completada con éxito.`);

            // Final signals
            await writeLog(`\nJSON_START`);
            await writeLog(JSON.stringify({ success: true, message: `Proyecto ${projectName} migrado a ${targetCreds.host}` }));
            await writeLog(`JSON_END`);

        } catch (error: any) {
            await writeLog(`\n❌ Error en migración: ${error.message}`);
        } finally {
            if (sourceClient) sourceClient.end();
            if (targetClient) targetClient.end();
            await writer.close();
        }
    };

    processMigration();

    return new NextResponse(stream.readable, {
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Transfer-Encoding': 'chunked',
            'Cache-Control': 'no-cache, no-transform',
        },
    });
}
