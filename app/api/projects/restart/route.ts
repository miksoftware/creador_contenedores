import { NextRequest, NextResponse } from 'next/server';
import { Client } from 'ssh2';
import { generateRestartProjectScript } from '@/lib/project-manager';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    const body = await req.json();
    const { host, username, password, projectName, projectType } = body;

    if (!host || !username || !password || !projectName) {
        return NextResponse.json({ error: 'Missing credentials or project name' }, { status: 400 });
    }

    const script = generateRestartProjectScript(projectName, projectType || 'php');

    const writeLog = async (msg: string, type: 'info' | 'error' | 'success' = 'info') => {
        const data = JSON.stringify({ type, message: msg }) + '\n';
        await writer.write(encoder.encode(data));
    };

    const sshClient = new Client();

    (async () => {
        try {
            await writeLog(`Connecting to ${host}...`);

            sshClient.on('ready', () => {
                writeLog('SSH Connection established.', 'success');
                writeLog(`Restarting project: ${projectName}...`);

                sshClient.exec('bash --login -s', (err, stream) => {
                    if (err) {
                        writeLog(`Execution error: ${err.message}`, 'error');
                        sshClient.end();
                        writer.close();
                        return;
                    }

                    stream.on('close', (code: any) => {
                        writeLog(`Process exited with code ${code}`, code === 0 ? 'success' : 'error');
                        sshClient.end();
                        writer.close();
                    }).on('data', (data: any) => {
                        writeLog(data.toString());
                    }).stderr.on('data', (data: any) => {
                        writeLog(data.toString(), 'error');
                    });

                    stream.write(script);
                    stream.end();
                });
            }).on('error', (err) => {
                writeLog(`SSH Connection Error: ${err.message}`, 'error');
                writer.close();
            }).connect({
                host,
                port: 22,
                username,
                password,
                readyTimeout: 20000,
            });
        } catch (error: any) {
            await writeLog(`Internal Server Error: ${error.message}`, 'error');
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
