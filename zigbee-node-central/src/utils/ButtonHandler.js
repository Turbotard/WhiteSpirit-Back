const xbee_api = require('xbee-api');
const C = xbee_api.constants;

// LED Control constants
const LED_D1 = "D1";
const LED_ON = "04";
const LED_OFF = "00";

class ButtonHandler {
  constructor(xbeeAPI, mqttClient) {
    this.xbeeAPI = xbeeAPI;
    this.mqttClient = mqttClient;
    this.isLedOn = false;
    
    // Button debounce
    this.lastButtonState = 1; // Initialize to 1 (not pressed) since button is pull-up
    this.buttonPressed = false;

    // Configure LED on startup
    this.configureLED();
  }

  // Configure LED on startup
  configureLED() {
    console.log("Configuring LED D1...");
    
    // Configure D1 as digital output
    const configFrame = {
      type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
      destination64: "0013a20041fb6063",
      command: "D1",
      commandParameter: ["03"], // 03 = Digital Output
    };
    this.xbeeAPI.builder.write(configFrame);
    console.log("Sent D1 configuration");

    // Turn off LED initially
    this.controlLED(LED_OFF);
    console.log("Turned off LED initially");
  }

  // Function to send command to control LED
  controlLED(state) {
    console.log(`Sending command: LED D1 -> ${state}`);
    const frame_obj = {
      type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
      destination64: "0013a20041fb6063",
      command: LED_D1,
      commandParameter: [state],
    };
    console.log("Frame object:", JSON.stringify(frame_obj, null, 2));
    this.xbeeAPI.builder.write(frame_obj);
    console.log("Command sent to XBee");
    
    // Publish LED state to MQTT
    if (this.mqttClient) {
      this.mqttClient.publish('zigbee/led/state', JSON.stringify({
        led: LED_D1,
        state: state === LED_ON ? 'on' : 'off'
      }));
    }
  }

  // Handle button state change
  handleButtonState(buttonState) {
    console.log(`Button state: ${buttonState}, Last state: ${this.lastButtonState}`);
    
    // Detect button press (transition from 1 to 0)
    if (buttonState === 0 && this.lastButtonState === 1) {
      console.log("Button pressed - toggling LED");
      
      // Toggle LED state
      this.isLedOn = !this.isLedOn;
      this.controlLED(this.isLedOn ? LED_ON : LED_OFF);
      
      // Publish button press to MQTT
      if (this.mqttClient) {
        this.mqttClient.publish('zigbee/button/event', JSON.stringify({
          event: 'pressed',
          ledState: this.isLedOn ? 'on' : 'off',
          timestamp: Date.now()
        }));
      }
    }
    
    this.lastButtonState = buttonState;
  }
}

module.exports = ButtonHandler;
