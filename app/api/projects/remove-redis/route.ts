import { NextRequest, NextResponse } from 'next/server';
import { Client } from 'ssh2';
import { generateRemoveRedisScript } from '@/lib/project-manager';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    const body = await req.json();
    const { host, username, password, projectName } = body;

    if (!host || !username || !password || !projectName) {
        return NextResponse.json({ error: 'Missing credentials or projectName' }, { status: 400 });
    }

    const scriptContent = generateRemoveRedisScript(projectName);

    const writeLog = async (msg: string) => {
        const data = JSON.stringify({ message: msg }) + '\n';
        await writer.write(encoder.encode(data));
    };

    const sshClient = new Client();

    (async () => {
        try {
            await writeLog(`🗑️ Iniciando eliminación de Redis en ${projectName}...`);

            sshClient.on('ready', () => {
                writeLog('✅ Conexión SSH establecida');

                sshClient.exec('bash --login -s', (err, stream) => {
                    if (err) {
                        writeLog(`❌ Error de ejecución: ${err.message}`);
                        sshClient.end();
                        writer.close();
                        return;
                    }

                    stream.on('close', (code: any) => {
                        writeLog(code === 0 ? '✅ Proceso completado' : `⚠️ Proceso terminó con código ${code}`);
                        sshClient.end();
                        writer.close();
                    }).on('data', (data: any) => {
                        const output = data.toString();
                        const lines = output.split('\n').filter((l: string) => l.trim());
                        for (const line of lines) {
                            writeLog(line);
                        }
                    }).stderr.on('data', (data: any) => {
                        const errText = data.toString().trim();
                        if (errText && !errText.includes('WARNING') && !errText.includes('WARN')) {
                            writeLog(`⚠️ ${errText}`);
                        }
                    });

                    stream.write(scriptContent);
                    stream.end();
                });
            }).on('error', (err) => {
                writeLog(`❌ Error de conexión SSH: ${err.message}`);
                writer.close();
            }).connect({
                host,
                port: 22,
                username,
                password,
                readyTimeout: 20000,
                tryKeyboard: true,
            });

            sshClient.on('keyboard-interactive', (name: any, instructions: any, instructionsLang: any, prompts: any, finish: any) => {
                finish([password]);
            });

        } catch (error: any) {
            await writeLog(`❌ Error interno: ${error.message}`);
            await writer.close();
        }
    })();

    return new NextResponse(stream.readable, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}
