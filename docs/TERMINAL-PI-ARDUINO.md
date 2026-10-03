# Terminal, Raspberry Pi e Arduino

## Salinha no terminal (Linux sem tela, SSH, Raspberry Pi)
`node tools/terminal/sala.mjs [projeto]`: mostra o AgentC com a caixinha de fala da última mensagem, uma mesa por agente (trabalhando, parado, travado, pronto) e as últimas falas. Digite e aperte Enter para falar na sala; `/sair` fecha. Sem dependências.

De outro aparelho, pelo Tailscale: `AGENT_CONTROL_URL=http://IP-DO-PC:20150 AGENT_CONTROL_TOKEN=... node tools/terminal/sala.mjs`.

## Raspberry Pi
`bash tools/raspberry/instalar.sh` instala, cria `jarvis.config.json` e liga o servidor como serviço (systemd do usuário), só em 127.0.0.1. Precisa do Node 24+ (Raspberry Pi OS 64 bits; Pi 4 ou 5 recomendado).

## Arduino
O Arduino não roda agentes; ele mostra o estado deles. Grave `hardware/arduino/AgentControlLeds/AgentControlLeds.ino` (Arduino IDE), ligue LEDs com resistor de 220 Ω nos pinos 2 a 9 (um por agente) e um buzzer no 10.
Depois, no PC ou Pi onde ele está na USB: `node tools/arduino/ponte.mjs /dev/ttyACM0` (Windows: `COM3`).
Aceso = trabalhando, pisca rápido = travado, pisca lento = pronto, apagado = parado. Apito = fala nova na sala.
