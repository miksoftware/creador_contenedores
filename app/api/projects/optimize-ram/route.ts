import { NextRequest, NextResponse } from 'next/server';
import { Client } from 'ssh2';
import { generateOptimizeRamScript } from '@/lib/project-manager';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    const body = await req.json();
    const { host, username, password } = body;

    if (!host || !username || !password) {
        return NextResponse.json({ error: 'Missing credentials' }, { status: 400 });
    }

    const scriptContent = generateOptimizeRamScript();

    const writeLog = async (msg: string) => {
        const data = JSON.stringify({ message: msg }) + '\n';
        await writer.write(encoder.encode(data));
    };

    const sshClient = new Client();

    (async () => {
        try {
            await writeLog('🔌 Conectando al servidor...');

            sshClient.on('ready', () => {
                writeLog('✅ Conexión SSH establecida');
                writeLog('🧠 Iniciando optimización de RAM...');

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
                        // Only log real errors, not python/docker warnings
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

            sshClient.on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
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
