const xbee_api = require('xbee-api');
const C = xbee_api.constants;

// LED Control constants
const LED_D1 = "D1";
const LED_D2 = "D2";
const LED_ON = "04";
const LED_OFF = "00";

class ButtonHandler {
  constructor(xbeeAPI, mqttClient) {
    this.xbeeAPI = xbeeAPI;
    this.mqttClient = mqttClient;
    this.isLedOn = false;
    this.xbeeId = "0013a20041fb6063"; // Store XBee ID for reuse
    
    // Button debounce
    this.lastButtonState = 1; // Initialize to 1 (not pressed) since button is pull-up
    this.buttonPressed = false;
    
    // Flags to prevent message loops
    this.processingReadyToOrder = false;
    this.processingOrderReady = false;

    // Configure LED on startup
    this.configureLED();

    // COMPLETE REWRITE OF MQTT SUBSCRIPTION LOGIC
    
    // Subscribe only to order_ready (completely separate from ready_to_order)
    this.mqttClient.subscribe('restaurant/tables/+/order_ready');
    
    // For order_ready messages, ALWAYS and ONLY control D2
    this.mqttClient.on('message', (topic, message) => {
      if (topic.includes('order_ready')) {
        console.log("=== WEB ACTION ===");
        console.log("Received order_ready message (web -> D2)");
        try {
          // First, always turn off D1 when order_ready is received
          console.log("First turning off D1 as requested");
          this.directControlLED(LED_OFF, LED_D1);
          
          const data = JSON.parse(message.toString());
          // Force LED D2 for order_ready (web actions), regardless of message content
          console.log("Control LED D2 based on web action");
          if (data.state === 'on') {
            this.directControlLED(LED_ON, LED_D2);
          } else {
            this.directControlLED(LED_OFF, LED_D2);
          }
        } catch (error) {
          console.error("Error handling order_ready message:", error);
          // Even on error, turn off D1 and D2
          this.directControlLED(LED_OFF, LED_D1);
          this.directControlLED(LED_OFF, LED_D2);
        }
      }
    });
  }
  
  // Direct control of LED without any MQTT side effects
  directControlLED(state, ledPin) {
    console.log(`Direct control: LED ${ledPin} -> ${state}`);
    const frame_obj = {
      type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
      destination64: this.xbeeId,
      command: ledPin,
      commandParameter: [state],
    };
    this.xbeeAPI.builder.write(frame_obj);
    console.log(`Command sent to XBee to control ${ledPin}`);
  }

  // Configure LED on startup
  configureLED() {
    console.log("Configuring LED D1 and D2...");
    
    // Configure D1 as digital output
    const configD1 = {
      type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
      destination64: this.xbeeId,
      command: "D1",
      commandParameter: ["03"], // 03 = Digital Output
    };
    this.xbeeAPI.builder.write(configD1);
    console.log("Sent D1 configuration");
    
    // Configure D2 as digital output
    const configD2 = {
      type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
      destination64: this.xbeeId,
      command: "D2",
      commandParameter: ["03"], // 03 = Digital Output
    };
    this.xbeeAPI.builder.write(configD2);
    console.log("Sent D2 configuration");

    // Turn off LEDs initially
    this.directControlLED(LED_OFF, LED_D1);
    this.directControlLED(LED_OFF, LED_D2);
    console.log("Turned off LEDs initially");
  }

  // Function to send command to control LED and publish MQTT
  controlLED(state, ledPin = LED_D1, publishMqtt = true) {
    // This is now ONLY for the button handler
    console.log(`Button controlLED: LED ${ledPin} -> ${state}`);
    
    // Direct control without MQTT loops
    this.directControlLED(state, ledPin);
    
    // Only publish MQTT if specified - will ONLY be used by button
    if (publishMqtt && this.mqttClient) {
      console.log("Publishing to ready_to_order topic");
      this.mqttClient.publish('restaurant/tables/{id_table}/ready_to_order', JSON.stringify({
        led: ledPin,
        state: state === LED_ON ? 'on' : 'off',
        xbee_id: this.xbeeId,
        timestamp: new Date().toISOString()
      }));
    }
  }

  // Handle button state change
  handleButtonState(buttonState) {
    console.log(`Button state: ${buttonState}, Last state: ${this.lastButtonState}`);
    
    // Detect button press (transition from 1 to 0)
    if (buttonState === 0 && this.lastButtonState === 1 && !this.buttonPressed) {
      console.log("=== BUTTON ACTION ===");
      console.log("Physical button pressed - controlling ONLY LED D1");
      
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
