import { NextRequest, NextResponse } from 'next/server';
import { Client } from 'ssh2';
import { generateSetupScript, ProjectConfig } from '@/lib/script-generator';
import { generateDockerAppScript, DockerAppConfig } from '@/lib/docker-apps-generator';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    const body = await req.json();
    const { host, username, password, projectConfig, dockerAppConfig } = body;

    if (!host || !username || !password || (!projectConfig && !dockerAppConfig)) {
        return NextResponse.json({ error: 'Missing credentials or config' }, { status: 400 });
    }

    const scriptContent = dockerAppConfig
        ? generateDockerAppScript(dockerAppConfig as DockerAppConfig)
        : generateSetupScript(projectConfig as ProjectConfig);

    const writeLog = async (msg: string, type: 'info' | 'error' | 'success' | 'json' = 'info') => {
        const data = JSON.stringify({ type, message: msg }) + '\n';
        await writer.write(encoder.encode(data));
    };

    const sshClient = new Client();

    // Run the SSH process in the background effectively
    (async () => {
        try {
            await writeLog(`Attempting to connect to ${host}...`);

            sshClient.on('ready', () => {
                writeLog('SSH Connection established.', 'success');
                writeLog('Uploading and executing setup script...');

                // We'll execute the script directly by passing it to 'bash -s'
                // This avoids needing to SCP a file.
                // We use single quotes for the bash -s command to avoid shell expansion on the local side (though here we are just sending string)
                sshClient.exec('bash --login -s', (err, stream) => {
                    if (err) {
                        writeLog(`Execution error: ${err.message}`, 'error');
                        sshClient.end();
                        writer.close();
                        return;
                    }

                    stream.on('close', (code: any, signal: any) => {
                        writeLog(`Script process exited with code ${code}`, code === 0 ? 'success' : 'error');
                        sshClient.end();
                        writer.close();
                    }).on('data', (data: any) => {
                        const output = data.toString();
                        // Check for JSON block in output
                        if (output.includes('JSON_START')) {
                            // We might want to buffer this to parse fully, but for simpler streaming:
                            // We will just stream it and let frontend parse if it sees the markers.
                        }
                        writeLog(output);
                    }).stderr.on('data', (data: any) => {
                        writeLog(data.toString(), 'error');
                    });

                    // Write the script to stdin
                    stream.write(scriptContent);
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
