import { NextRequest, NextResponse } from 'next/server';
import { Client } from 'ssh2';
import { generateListProjectsScript } from '@/lib/project-manager';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const body = await req.json();
    const { host, username, password } = body;

    if (!host || !username || !password) {
        return NextResponse.json({ error: 'Missing credentials' }, { status: 400 });
    }

    const script = generateListProjectsScript();

    return new Promise<NextResponse>((resolve) => {
        const sshClient = new Client();
        let output = '';
        let timedOut = false;

        const timeout = setTimeout(() => {
            timedOut = true;
            sshClient.end();
            resolve(NextResponse.json({ error: 'Connection timed out' }, { status: 504 }));
        }, 30000);

        sshClient.on('ready', () => {
            sshClient.exec('bash --login -s', (err, stream) => {
                if (err) {
                    clearTimeout(timeout);
                    sshClient.end();
                    resolve(NextResponse.json({ error: err.message }, { status: 500 }));
                    return;
                }

                stream.on('close', () => {
                    clearTimeout(timeout);
                    if (timedOut) return;
                    sshClient.end();

                    try {
                        const projects: any[] = [];
                        const lines = output.split('\n');

                        for (const line of lines) {
                            if (line.startsWith('PROJECT_LINE|')) {
                                const parts = line.split('|');
                                // PROJECT_LINE|name|type|phpVersion|domain|size|containersRunning|containersTotal
                                if (parts.length >= 8) {
                                    projects.push({
                                        name: parts[1] || '',
                                        type: parts[2] || 'unknown',
                                        phpVersion: parts[3] || '',
                                        domain: parts[4] || '',
                                        size: parts[5] || '0',
                                        containersRunning: parseInt(parts[6]) || 0,
                                        containersTotal: parseInt(parts[7]) || 0,
                                        containers: [],
                                    });
                                }
                            }
                        }

                        resolve(NextResponse.json({ projects }));
                    } catch (e: any) {
                        resolve(NextResponse.json({ error: 'Failed to parse: ' + e.message, raw: output }, { status: 500 }));
                    }
                }).on('data', (data: any) => {
                    output += data.toString();
                }).stderr.on('data', (data: any) => {
                    // Ignore stderr (docker warnings, etc)
                });

                stream.write(script);
                stream.end();
            });
        }).on('error', (err) => {
            clearTimeout(timeout);
            if (timedOut) return;
            resolve(NextResponse.json({ error: err.message }, { status: 500 }));
        }).connect({
            host,
            port: 22,
            username,
            password,
            readyTimeout: 20000,
        });
    });
}
