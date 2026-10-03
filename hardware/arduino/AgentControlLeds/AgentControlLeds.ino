// Agent Control no Arduino: um LED por agente (até 8) e um buzzer que apita quando chega fala nova na sala.
// O Arduino não roda os agentes: quem manda o estado é tools/arduino/ponte.mjs, num PC ou Raspberry Pi pela USB.
//
// Ligação: LEDs (com resistor de 220 ohms) nos pinos 2 a 9, buzzer no pino 10. Serial 9600.
// Protocolo, uma linha por vez:
//   S:01230000   estado de cada agente: 0 parado (apagado), 1 trabalhando (aceso), 2 travado (pisca), 3 pronto (pulso lento)
//   B            apito curto (fala nova)

const int FIRST_LED = 2, N = 8, BUZZER = 10;
char state[N];
String line;

void setup() {
  Serial.begin(9600);
  for (int i = 0; i < N; i++) { pinMode(FIRST_LED + i, OUTPUT); state[i] = '0'; }
  pinMode(BUZZER, OUTPUT);
  // Teste ao ligar: acende um por um.
  for (int i = 0; i < N; i++) { digitalWrite(FIRST_LED + i, HIGH); delay(80); digitalWrite(FIRST_LED + i, LOW); }
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      line.trim();
      if (line.startsWith("S:")) for (int i = 0; i < N; i++) state[i] = i + 2 < (int)line.length() ? line[i + 2] : '0';
      else if (line == "B") tone(BUZZER, 1760, 120);
      line = "";
    } else if (line.length() < 32) line += c;
  }
  unsigned long t = millis();
  for (int i = 0; i < N; i++) {
    bool on = false;
    switch (state[i]) {
      case '1': on = true; break;
      case '2': on = (t / 200) % 2; break;
      case '3': on = (t / 1000) % 2; break;
    }
    digitalWrite(FIRST_LED + i, on ? HIGH : LOW);
  }
}
