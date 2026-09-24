const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    downloadContentFromMessage
} = require("@whiskeysockets/baileys");

const P = require("pino");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const config = require("./config");

const PREFIX = config.prefixo;

const AUTH_DIR = path.join(__dirname, "auth");
const TEMP_DIR = path.join(__dirname, "temp");

if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, {
        recursive: true
    });
}

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, {
        recursive: true
    });
}


// ======================================================
// UTILIDADES
// ======================================================

function log(text) {
    console.log(`[BOT] ${text}`);
}


function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}


function getSender(msg) {
    return (
        msg.key.participant ||
        msg.key.remoteJid ||
        ""
    )
        .split(":")[0];
}


function isOwner(jid) {
    const numero = jid
        .split("@")[0]
        .split(":")[0];

    return numero === String(config.dono)
        .replace(/\D/g, "");
}


// ======================================================
// DOWNLOAD DE MÍDIA
// ======================================================

async function baixarMidia(message, tipo) {

    const stream = await downloadContentFromMessage(
        message,
        tipo
    );

    const chunks = [];

    for await (const chunk of stream) {
        chunks.push(chunk);
    }

    return Buffer.concat(chunks);
}


// ======================================================
// FFmpeg
// ======================================================

function executarFFmpeg(args) {

    return new Promise((resolve, reject) => {

        execFile(
            "ffmpeg",
            args,
            {
                windowsHide: true
            },
            (error, stdout, stderr) => {

                if (error) {
                    console.error(stderr);
                    reject(error);
                    return;
                }

                resolve();
            }
        );
    });
}


// ======================================================
// IMAGEM → FIGURINHA
// ======================================================

async function criarFigurinhaImagem(
    buffer,
    extensao = "jpg"
) {

    const id =
        `${Date.now()}_${Math.random()
            .toString(36)
            .substring(2, 8)}`;

    const entrada = path.join(
        TEMP_DIR,
        `${id}.${extensao}`
    );

    const saida = path.join(
        TEMP_DIR,
        `${id}.webp`
    );

    fs.writeFileSync(
        entrada,
        buffer
    );

    try {

        await executarFFmpeg([
            "-y",

            "-i",
            entrada,

            "-vf",
            "scale=512:512:force_original_aspect_ratio=decrease," +
            "pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0",

            "-c:v",
            "libwebp",

            "-quality",
            "90",

            "-preset",
            "picture",

            saida
        ]);

        return fs.readFileSync(
            saida
        );

    } finally {

        try {
            fs.unlinkSync(entrada);
        } catch {}

        try {
            fs.unlinkSync(saida);
        } catch {}
    }
}


// ======================================================
// VÍDEO → FIGURINHA ANIMADA
// ======================================================

async function criarFigurinhaAnimada(
    buffer
) {

    const id =
        `${Date.now()}_${Math.random()
            .toString(36)
            .substring(2, 8)}`;

    const entrada = path.join(
        TEMP_DIR,
        `${id}.mp4`
    );

    const saida = path.join(
        TEMP_DIR,
        `${id}.webp`
    );

    fs.writeFileSync(
        entrada,
        buffer
    );

    try {

        await executarFFmpeg([
            "-y",

            "-i",
            entrada,

            "-t",
            String(config.maxVideoSeconds),

            "-vf",
            "scale=512:512:force_original_aspect_ratio=decrease," +
            "pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0," +
            "fps=15",

            "-c:v",
            "libwebp",

            "-lossless",
            "0",

            "-q:v",
            "60",

            "-loop",
            "0",

            "-an",

            saida
        ]);

        return fs.readFileSync(
            saida
        );

    } finally {

        try {
            fs.unlinkSync(entrada);
        } catch {}

        try {
            fs.unlinkSync(saida);
        } catch {}
    }
}


// ======================================================
// ENVIAR FIGURINHA
// ======================================================

async function enviarFigurinha(
    sock,
    jid,
    buffer
) {

    await sock.sendMessage(
        jid,
        {
            sticker: buffer
        }
    );
}


// ======================================================
// ENVIAR TEXTO
// ======================================================

async function responder(
    sock,
    jid,
    texto
) {

    await sock.sendMessage(
        jid,
        {
            text: texto
        }
    );
}


// ======================================================
// MENU
// ======================================================

async function menu(
    sock,
    jid
) {

    const texto = `

╭━━━━━━━━━━━━━━━━━━━━━━╮
┃   🤖 NUNUU STICKER   ┃
╰━━━━━━━━━━━━━━━━━━━━━━╯

🖼️ FIGURINHAS

/s
→ Responda uma imagem.

/sticker
→ Responda uma imagem.

/figurinha
→ Responda uma imagem.


🎬 VÍDEOS

/s
→ Responda um vídeo.


📋 OUTROS

/menu
→ Mostra este menu.

 /ping
→ Testa o bot.

 /info
→ Informações do bot.


━━━━━━━━━━━━━━━━━━━━━━

🤖 Bot funcionando!
🇧🇷 Português
`;

    await responder(
        sock,
        jid,
        texto
    );
}


// ======================================================
// PROCESSAR COMANDOS
// ======================================================

async function processarComando(
    sock,
    msg
) {

    const jid =
        msg.key.remoteJid;

    if (!jid) {
        return;
    }

    const texto =
        msg.message?.conversation ||
        msg.message
            ?.extendedTextMessage
            ?.text ||
        "";

    const textoLimpo =
        texto.trim();

    if (
        !textoLimpo.startsWith(PREFIX)
    ) {
        return;
    }

    const partes =
        textoLimpo
            .slice(PREFIX.length)
            .trim()
            .split(/\s+/);

    const comando =
        (
            partes.shift() ||
            ""
        ).toLowerCase();


    // ==================================================
    // MENU
    // ==================================================

    if (
        comando === "menu" ||
        comando === "help"
    ) {

        await menu(
            sock,
            jid
        );

        return;
    }


    // ==================================================
    // PING
    // ==================================================

    if (
        comando === "ping"
    ) {

        await responder(
            sock,
            jid,
            "🏓 Pong!\n\n🤖 Bot funcionando normalmente."
        );

        return;
    }


    // ==================================================
    // INFO
    // ==================================================

    if (
        comando === "info"
    ) {

        await responder(
            sock,
            jid,
            `🤖 ${config.nomeBot}

🖼️ Imagens: ✅
🎬 Vídeos: ✅
🔐 Pareamento por código: ✅
📱 WhatsApp: ✅
🇧🇷 Português: ✅

Prefixo: ${PREFIX}`
        );

        return;
    }


    // ==================================================
    // COMANDOS DE FIGURINHA
    // ==================================================

    if (
        comando !== "s" &&
        comando !== "sticker" &&
        comando !== "figurinha"
    ) {
        return;
    }


    await responder(
        sock,
        jid,
        "⏳ Criando sua figurinha..."
    );


    try {

        const quoted =
            msg.message
                ?.extendedTextMessage
                ?.contextInfo
                ?.quotedMessage;

        let alvo =
            quoted ||
            msg.message;


        // ==============================================
        // IMAGEM
        // ==============================================

        if (
            alvo?.imageMessage
        ) {

            const imagem =
                alvo.imageMessage;

            const buffer =
                await baixarMidia(
                    imagem,
                    "image"
                );


            let extensao = "jpg";

            const mimetype =
                imagem.mimetype || "";

            if (
                mimetype.includes("png")
            ) {
                extensao = "png";
            }

            if (
                mimetype.includes("webp")
            ) {
                extensao = "webp";
            }


            const sticker =
                await criarFigurinhaImagem(
                    buffer,
                    extensao
                );


            await enviarFigurinha(
                sock,
                jid,
                sticker
            );

            return;
        }


        // ==============================================
        // VÍDEO
        // ==============================================

        if (
            alvo?.videoMessage
        ) {

            const buffer =
                await baixarMidia(
                    alvo.videoMessage,
                    "video"
                );


            const sticker =
                await criarFigurinhaAnimada(
                    buffer
                );


            await enviarFigurinha(
                sock,
                jid,
                sticker
            );

            return;
        }


        // ==============================================
        // NADA ENCONTRADO
        // ==============================================

        await responder(
            sock,
            jid,
            `❌ Não encontrei uma imagem ou vídeo.

Envie uma imagem/vídeo ou responda uma mídia com:

${PREFIX}s`
        );

    } catch (erro) {

        console.error(
            "Erro ao criar figurinha:",
            erro
        );

        await responder(
            sock,
            jid,
            `❌ Não consegui criar a figurinha.

Verifique se o FFmpeg está instalado:

ffmpeg -version`
        );
    }
}


// ======================================================
// CONEXÃO WHATSAPP
// ======================================================

async function iniciarBot() {

    const {
        state,
        saveCreds
    } = await useMultiFileAuthState(
        AUTH_DIR
    );


    const sock =
        makeWASocket({

            auth: state,

            logger: P({
                level: "silent"
            }),

            // IMPORTANTE:
            // NÃO MOSTRA QR CODE
            printQRInTerminal: false,

            browser: [
                "NUNUU STICKER",
                "Chrome",
                "1.0.0"
            ]
        });


    // ==================================================
    // SALVAR AUTENTICAÇÃO
    // ==================================================

    sock.ev.on(
        "creds.update",
        saveCreds
    );


    // ==================================================
    // CONEXÃO
    // ==================================================

    let codigoSolicitado = false;


    sock.ev.on(
        "connection.update",
        async update => {

            const {
                connection,
                lastDisconnect
            } = update;


            // ==========================================
            // CÓDIGO DE PAREAMENTO
            // ==========================================

            if (
                connection === "connecting" &&
                !state.creds.registered &&
                !codigoSolicitado
            ) {

                codigoSolicitado = true;

                try {

                    const numero =
                        String(
                            config.numero
                        )
                        .replace(
                            /\D/g,
                            ""
                        );


                    if (!numero) {

                        console.log("");
                        console.log(
                            "❌ ERRO: configure seu número no config.js"
                        );

                        return;
                    }


                    const codigo =
                        await sock.requestPairingCode(
                            numero
                        );


                    console.log("");
                    console.log(
                        "=========================================="
                    );
                    console.log(
                        "          🤖 NUNUU STICKER"
                    );
                    console.log(
                        "=========================================="
                    );
                    console.log("");
                    console.log(
                        "🔐 CÓDIGO DE PAREAMENTO:"
                    );
                    console.log("");
                    console.log(
                        `              ${codigo}`
                    );
                    console.log("");
                    console.log(
                        "📱 NO WHATSAPP:"
                    );
                    console.log(
                        "Aparelhos conectados"
                    );
                    console.log(
                        "→ Conectar aparelho"
                    );
                    console.log(
                        "→ Conectar com número de telefone"
                    );
                    console.log("");
                    console.log(
                        "=========================================="
                    );
                    console.log("");

                } catch (erro) {

                    codigoSolicitado = false;

                    console.error(
                        "❌ Erro ao gerar código de pareamento:"
                    );

                    console.error(
                        erro
                    );
                }
            }


            // ==========================================
            // CONECTADO
            // ==========================================

            if (
                connection === "open"
            ) {

                console.clear();

                console.log("");
                console.log(
                    "=========================================="
                );
                console.log(
                    "       🤖 NUNUU STICKER ONLINE"
                );
                console.log(
                    "=========================================="
                );
                console.log("");
                console.log(
                    "✅ WhatsApp conectado!"
                );
                console.log(
                    "🖼️ Figurinhas de imagem: OK"
                );
                console.log(
                    "🎬 Figurinhas animadas: OK"
                );
                console.log(
                    "🔐 Pareamento por código: OK"
                );
                console.log("");
                console.log(
                    `📌 Prefixo: ${PREFIX}`
                );
                console.log("");
                console.log(
                    "Digite /menu no WhatsApp."
                );
                console.log("");
            }


            // ==========================================
            // CONEXÃO FECHADA
            // ==========================================

            if (
                connection === "close"
            ) {

                const statusCode =
                    lastDisconnect
                        ?.error
                        ?.output
                        ?.statusCode;


                const shouldReconnect =
                    statusCode !==
                    DisconnectReason.loggedOut;


                console.log("");
                console.log(
                    "⚠️ Conexão encerrada."
                );
                console.log(
                    `Código: ${statusCode}`
                );


                if (
                    shouldReconnect
                ) {

                    console.log(
                        "🔄 Reconectando..."
                    );

                    await sleep(
                        3000
                    );

                    iniciarBot();

                } else {

                    console.log(
                        "❌ Sessão desconectada."
                    );

                    console.log(
                        "Apague a pasta auth e faça um novo pareamento."
                    );
                }
            }
        }
    );


    // ==================================================
    // RECEBER MENSAGENS
    // ==================================================

    sock.ev.on(
        "messages.upsert",
        async ({ messages }) => {

            for (
                const msg of messages
            ) {

                if (!msg) {
                    continue;
                }

                if (
                    msg.key.fromMe
                ) {
                    continue;
                }

                if (
                    !msg.message
                ) {
                    continue;
                }


                try {

                    await processarComando(
                        sock,
                        msg
                    );

                } catch (erro) {

                    console.error(
                        "❌ Erro ao processar mensagem:",
                        erro
                    );
                }
            }
        }
    );
}


// ======================================================
// TRATAMENTO DE ERROS
// ======================================================

process.on(
    "uncaughtException",
    erro => {

        console.error(
            "❌ Erro não tratado:",
            erro
        );
    }
);


process.on(
    "unhandledRejection",
    erro => {

        console.error(
            "❌ Promise rejeitada:",
            erro
        );
    }
);


// ======================================================
// INICIAR
// ======================================================

console.log("");
console.log(
    "🤖 Iniciando NUNUU STICKER..."
);
console.log(
    "🔐 Modo: código de pareamento"
);
console.log(
    "🚫 QR Code: DESATIVADO"
);
console.log("");

iniciarBot();
