const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    downloadMediaMessage
} = require("@whiskeysockets/baileys");

const P = require("pino");
const sharp = require("sharp");
const readline = require("readline");
const fs = require("fs");

const SESSION_DIR = "./auth_info";

function perguntar(texto) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => {
        rl.question(texto, resposta => {
            rl.close();
            resolve(resposta);
        });
    });
}

async function criarFigurinha(buffer) {
    return await sharp(buffer)
        .resize(512, 512, {
            fit: "contain",
            background: {
                r: 0,
                g: 0,
                b: 0,
                alpha: 0
            }
        })
        .webp({
            quality: 90
        })
        .toBuffer();
}

async function iniciarBot() {
    const { state, saveCreds } =
        await useMultiFileAuthState(SESSION_DIR);

    const sock = makeWASocket({
        auth: state,

        logger: P({
            level: "silent"
        }),

        printQRInTerminal: false,

        browser: [
            "Sticker Bot",
            "Chrome",
            "1.0.0"
        ],

        generateHighQualityLinkPreview: false
    });

    /*
    =====================================================
    CÓDIGO DE PAREAMENTO
    =====================================================
    */

    if (!sock.authState.creds.registered) {

        let numero = await perguntar(
            "\nDigite seu número do WhatsApp com DDI:\n" +
            "Exemplo: 5511999999999\n\n" +
            "Número: "
        );

        numero = numero.replace(/\D/g, "");

        if (!numero) {
            console.log("Número inválido.");
            process.exit(1);
        }

        try {
            console.log("\nGerando código de pareamento...\n");

            const codigo =
                await sock.requestPairingCode(numero);

            console.log(
                "\n===================================="
            );

            console.log(
                "      CÓDIGO DE PAREAMENTO"
            );

            console.log(
                "===================================="
            );

            console.log("\n        " + codigo + "\n");

            console.log(
                "===================================="
            );

            console.log(
                "No WhatsApp:"
            );

            console.log(
                "Dispositivos conectados"
            );

            console.log(
                "→ Conectar dispositivo"
            );

            console.log(
                "→ Conectar com número de telefone"
            );

            console.log(
                "→ Digite o código acima"
            );

            console.log(
                "====================================\n"
            );

        } catch (erro) {

            console.log(
                "Erro ao gerar código de pareamento:"
            );

            console.log(erro);

            process.exit(1);
        }
    }

    /*
    =====================================================
    EVENTOS DE CONEXÃO
    =====================================================
    */

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async update => {

        const {
            connection,
            lastDisconnect
        } = update;

        if (connection === "open") {

            console.log("\n====================================");
            console.log("       BOT CONECTADO!");
            console.log("====================================");
            console.log("Comandos:");
            console.log("!s       → criar figurinha");
            console.log("!sticker → criar figurinha");
            console.log("!menu    → mostrar menu");
            console.log("====================================\n");
        }

        if (connection === "close") {

            const codigoErro =
                lastDisconnect?.error?.output?.statusCode;

            const deveReconectar =
                codigoErro !== DisconnectReason.loggedOut;

            console.log(
                "\nConexão encerrada."
            );

            if (deveReconectar) {

                console.log(
                    "Tentando reconectar..."
                );

                setTimeout(() => {
                    iniciarBot();
                }, 3000);

            } else {

                console.log(
                    "Sessão encerrada pelo WhatsApp."
                );

                console.log(
                    "Apague a pasta auth_info e faça o pareamento novamente."
                );
            }
        }
    });

    /*
    =====================================================
    MENSAGENS
    =====================================================
    */

    sock.ev.on("messages.upsert", async ({ messages }) => {

        try {

            const msg = messages[0];

            if (!msg.message) return;

            if (msg.key.fromMe) return;

            const jid = msg.key.remoteJid;

            if (!jid) return;

            const tipo =
                Object.keys(msg.message)[0];

            /*
            ==============================
            TEXTO
            ==============================
            */

            const texto =
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                "";

            const comando =
                texto.trim().toLowerCase();

            /*
            ==============================
            MENU
            ==============================
            */

            if (comando === "!menu") {

                await sock.sendMessage(jid, {
                    text:
`🤖 *BOT DE FIGURINHAS*

📸 *!s*
Transforma uma imagem em figurinha.

🖼️ *!sticker*
Também cria uma figurinha.

🎬 *Vídeo/GIF*
Responda ao vídeo com !s.

💡 *Como usar:*
Envie uma imagem e escreva:

!s

Ou responda a uma imagem com:

!s`
                });

                return;
            }

            /*
            ==============================
            VERIFICAR COMANDO
            ==============================
            */

            const ehSticker =
                comando === "!s" ||
                comando === "!sticker";

            if (!ehSticker) return;

            /*
            ==============================
            IDENTIFICAR MÍDIA
            ==============================
            */

            let mensagemMidia = null;

            if (msg.message.imageMessage) {

                mensagemMidia = msg;

            } else if (msg.message.videoMessage) {

                mensagemMidia = msg;

            } else if (
                msg.message.extendedTextMessage?.contextInfo?.quotedMessage
            ) {

                const quoted =
                    msg.message.extendedTextMessage
                        .contextInfo
                        .quotedMessage;

                if (quoted.imageMessage) {

                    mensagemMidia = {
                        key: {
                            remoteJid: jid,
                            id:
                                msg.message
                                    .extendedTextMessage
                                    .contextInfo
                                    .stanzaId,
                            participant:
                                msg.message
                                    .extendedTextMessage
                                    .contextInfo
                                    .participant
                        },
                        message: quoted
                    };

                } else if (quoted.videoMessage) {

                    mensagemMidia = {
                        key: {
                            remoteJid: jid,
                            id:
                                msg.message
                                    .extendedTextMessage
                                    .contextInfo
                                    .stanzaId,
                            participant:
                                msg.message
                                    .extendedTextMessage
                                    .contextInfo
                                    .participant
                        },
                        message: quoted
                    };
                }
            }

            /*
            ==============================
            SEM MÍDIA
            ==============================
            */

            if (!mensagemMidia) {

                await sock.sendMessage(jid, {
                    text:
                        "❌ Envie ou responda a uma imagem com *!s*."
                });

                return;
            }

            /*
            ==============================
            REAÇÃO
            ==============================
            */

            await sock.sendMessage(jid, {
                react: {
                    text: "⏳",
                    key: msg.key
                }
            });

            /*
            ==============================
            BAIXAR
            ==============================
            */

            const buffer =
                await downloadMediaMessage(
                    mensagemMidia,
                    "buffer",
                    {},
                    {
                        logger: P({
                            level: "silent"
                        }),
                        reuploadRequest:
                            sock.updateMediaMessage
                    }
                );

            /*
            ==============================
            CRIAR WEBP
            ==============================
            */

            const sticker =
                await criarFigurinha(buffer);

            /*
            ==============================
            ENVIAR FIGURINHA
            ==============================
            */

            await sock.sendMessage(jid, {
                sticker
            });

            /*
            ==============================
            REAÇÃO FINAL
            ==============================
            */

            await sock.sendMessage(jid, {
                react: {
                    text: "✅",
                    key: msg.key
                }
            });

        } catch (erro) {

            console.log(
                "\nErro ao processar mensagem:"
            );

            console.log(erro);

            try {

                const jid =
                    messages[0]?.key?.remoteJid;

                if (jid) {

                    await sock.sendMessage(jid, {
                        text:
                            "❌ Não consegui criar a figurinha."
                    });
                }

            } catch {}
        }
    });
}

console.log(`
╔════════════════════════════════════╗
║       🤖 BOT DE FIGURINHAS        ║
║          WHATSAPP BOT             ║
╚════════════════════════════════════╝
`);

if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, {
        recursive: true
    });
}

iniciarBot().catch(erro => {

    console.error(
        "Erro ao iniciar o bot:"
    );

    console.error(erro);

});
