# Telegram MTProto Server

Servidor Node.js para autenticação MTProto com Telegram.

## Variáveis de ambiente

- `TELEGRAM_API_ID` - API ID do my.telegram.org
- `TELEGRAM_API_HASH` - API Hash do my.telegram.org
- `AUTH_SECRET` - Senha para autenticar requests

## Endpoints

- `GET /health` - Health check
- `POST /auth/send-code` - Envia código de verificação
- `POST /auth/verify-code` - Verifica código
- `POST /auth/verify-2fa` - Verifica senha 2FA
- `POST /messages/dialogs` - Lista conversas
- `POST /messages/unread` - Lista mensagens não lidas
