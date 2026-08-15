import { NextRequest, NextResponse } from 'next/server';
import { Client } from 'ssh2';
import { generateTestConnectionScript } from '@/lib/project-manager';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const body = await req.json();
    const { host, username, password } = body;

    if (!host || !username || !password) {
        return NextResponse.json({ ok: false, error: 'Faltan credenciales (host, usuario o contraseña)' }, { status: 400 });
    }

    const script = generateTestConnectionScript();

    return new Promise<NextResponse>((resolve) => {
        const sshClient = new Client();
        let output = '';
        let timedOut = false;

        const timeout = setTimeout(() => {
            timedOut = true;
            sshClient.end();
            resolve(NextResponse.json({ ok: false, error: 'Tiempo de conexión agotado (20s)' }, { status: 504 }));
        }, 20000);

        sshClient.on('ready', () => {
            const isRoot = username === 'root';
            const command = isRoot ? 'bash --login -s' : 'sudo -S bash --login -s';

            sshClient.exec(command, (err, stream) => {
                if (err) {
                    clearTimeout(timeout);
                    sshClient.end();
                    resolve(NextResponse.json({ ok: false, error: err.message }, { status: 500 }));
                    return;
                }

                stream.on('close', () => {
                    clearTimeout(timeout);
                    if (timedOut) return;
                    sshClient.end();

                    const match = output.match(/CONNECTION_OK\|([^\n|]+)\|([^\n|]*)\|([^\n|]*)/);
                    if (match) {
                        resolve(NextResponse.json({
                            ok: true,
                            hostname: match[1]?.trim() || host,
                            serverIp: match[2]?.trim() || host,
                            docker: match[3]?.trim() || 'no detectado',
                        }));
                    } else {
                        const errorLine = output.split('\n').find(l => l.startsWith('CONNECTION_ERROR|'));
                        const errorMsg = errorLine?.split('|')[1]?.trim() || 'No se pudo verificar la conexión';
                        resolve(NextResponse.json({ ok: false, error: errorMsg }, { status: 500 }));
                    }
                }).on('data', (data: Buffer) => {
                    output += data.toString();
                }).stderr.on('data', () => {});

                if (!isRoot) {
                    stream.write(password + '\n');
                }
                stream.write(script);
                stream.end();
            });
        }).on('error', (err) => {
            clearTimeout(timeout);
            if (timedOut) return;
            resolve(NextResponse.json({ ok: false, error: `Error SSH: ${err.message}` }, { status: 500 }));
        }).connect({
            host,
            port: 22,
            username,
            password,
            readyTimeout: 20000,
            tryKeyboard: true,
        });

        sshClient.on('keyboard-interactive', (_name, _instructions, _lang, _prompts, finish) => {
            finish([password]);
        });
    });
}