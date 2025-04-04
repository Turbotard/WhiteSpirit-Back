const xbee_api = require('xbee-api');
const C = xbee_api.constants;

// LED Control constants
const LED_D1 = "D1";
const LED_D2 = "D2";
const LED_ON = 4;  // 4 = Digital High (0x04 en hex)
const LED_OFF = 0; // 0 = Digital Low (0x00 en hex)

class ButtonHandler {
  constructor(xbeeAPI, mqttClient) {
    this.xbeeAPI = xbeeAPI;
    this.mqttClient = mqttClient;
    this.isLedOn = false;
    this.xbeeId = "0013a20041fb6063"; // Default XBee ID
    this.tableId = 1; // Default table ID, sera remplacé par la fonction handleButtonForTable
    
    // Button debounce
    this.lastButtonState = 1; // Initialize to 1 (not pressed) since button is pull-up
    this.buttonPressed = false;
    
    // Flags to prevent message loops
    this.processingReadyToOrder = false;
    this.processingOrderReady = false;

    // Configure LED on startup
    if (this.xbeeAPI) {
      this.configureLED();
    }

    // Ne plus s'abonner aux topics ici car c'est géré au niveau global
    // Également, ne plus traiter les messages MQTT ici pour éviter les doublons
  }
  
  // Direct control of LED without any MQTT side effects
  directControlLED(state, ledPin) {
    // Supprimer les logs excessifs
    if (!this.xbeeAPI) {
      return;
    }
    
    try {
      const frame_obj = {
        type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
        destination64: this.xbeeId,
        command: ledPin,
        commandParameter: [state],
      };
      this.xbeeAPI.builder.write(frame_obj);
    } catch (error) {
      console.error(`Table ${this.tableId}: Error sending LED command:`, error);
    }
  }

  // Configure LED on startup
  configureLED() {
    // Version simplifiée sans logs excessifs
    try {
      // Configure D1 as digital output (mode 4 = Digital Out, Low)
      const configD1 = {
        type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
        destination64: this.xbeeId,
        command: "D1",
        commandParameter: [4],
      };
      this.xbeeAPI.builder.write(configD1);
      
      // Configure D2 as digital output (mode 4 = Digital Out, Low)
      const configD2 = {
        type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
        destination64: this.xbeeId,
        command: "D2",
        commandParameter: [4],
      };
      this.xbeeAPI.builder.write(configD2);

      // Appliquer les changements
      const applyChanges = {
        type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
        destination64: this.xbeeId,
        command: "AC",
        commandParameter: [],
      };
      this.xbeeAPI.builder.write(applyChanges);

      // Éteindre les LEDs
      this.directControlLED(LED_OFF, LED_D1);
      this.directControlLED(LED_OFF, LED_D2);
    } catch (error) {
      console.error(`Table ${this.tableId}: Error configuring LEDs:`, error);
    }
  }

  // Function to send command to control LED and publish MQTT
  controlLED(state, ledPin = LED_D1, publishMqtt = true) {
    // Direct control without MQTT loops
    this.directControlLED(state, ledPin);
    
    // Only publish MQTT if specified - will ONLY be used by button
    if (publishMqtt && this.mqttClient) {
      // Determine the correct topic based on which LED
      let topic = `restaurant/tables/${this.tableId}/`;
      if (ledPin === LED_D1) {
        topic += 'ready_to_order';
      } else if (ledPin === LED_D2) {
        topic += 'order_ready';
      }
      
      this.mqttClient.publish(topic, JSON.stringify({
        table: this.tableId,
        led: ledPin,
        // Convertir les valeurs numériques 4/0 en 'on'/'off' pour MQTT
        state: state === LED_ON ? 'on' : 'off',
        xbee_id: this.xbeeId,
        timestamp: new Date().toISOString()
      }));
    }
  }

  // Handle button state change
  handleButtonState(buttonState, sourceXbeeId) {
    // Si un ID XBee source est fourni, vérifier qu'il correspond à notre XBee
    if (sourceXbeeId && sourceXbeeId.toLowerCase() !== this.xbeeId.toLowerCase()) {
      return;
    }
    
    // Detect button press (transition from 1 to 0)
    if (buttonState === 0 && this.lastButtonState === 1 && !this.buttonPressed) {
      // Set flag to prevent multiple presses
      this.buttonPressed = true;
      
      // Toggle LED state for D1 only
      this.isLedOn = !this.isLedOn;
      
      // Control LED D1 and publish to ready_to_order
      this.controlLED(this.isLedOn ? LED_ON : LED_OFF, LED_D1, true);
      
      // Reset flag after a delay
      setTimeout(() => {
        this.buttonPressed = false;
      }, 500);
    }
    
    this.lastButtonState = buttonState;
  }
}

module.exports = ButtonHandler;
