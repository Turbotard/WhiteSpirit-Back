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
    
    // Button debounce
    this.lastButtonState = 1; // Initialize to 1 (not pressed) since button is pull-up
    this.buttonPressed = false;

    // Configure LED on startup
    this.configureLED();

    // Subscribe to order_ready topic
    this.mqttClient.subscribe('restaurant/tables/+/order_ready');
    this.mqttClient.on('message', (topic, message) => {
      if (topic.includes('order_ready')) {
        console.log("Received order_ready message");
        this.handleOrderReady(topic, message);
      }
    });
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
      destination64: "0013A20041FB6063",
      command: LED_D1,
      commandParameter: [state],
    };
    console.log("Frame object:", JSON.stringify(frame_obj, null, 2));
    this.xbeeAPI.builder.write(frame_obj);
    console.log("Command sent to XBee");
    
    // Publish LED state to MQTT
    if (this.mqttClient) {
      this.mqttClient.publish('restaurant/tables/{id_table}/ready_to_order', JSON.stringify({
        led: LED_D1,
        state: state === LED_ON ? 'on' : 'off'
      }));
    }
  }

  // Handle order_ready message
  handleOrderReady(topic, message) {
    console.log("Handling order_ready message");
    try {
      const data = JSON.parse(message.toString());
      console.log("Message data:", data);
      
      // Set LED state based on the received message
      if (data.state === 'on') {
        this.controlLED(LED_ON);
        this.isLedOn = true;
      } else {
        this.controlLED(LED_OFF);
        this.isLedOn = false;
      }
    } catch (error) {
      console.error("Error parsing order_ready message:", error);
      // Default behavior: turn off LED
      this.controlLED(LED_OFF);
      this.isLedOn = false;
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
      
      // Publish ready_to_order message
      if (this.mqttClient) {
        this.mqttClient.publish('restaurant/tables/{id_table}/order_ready', JSON.stringify({
          led: LED_D2,
          state: this.isLedOn ? 'on' : 'off'
        }));
      }
    }
    
    this.lastButtonState = buttonState;
  }
}

module.exports = ButtonHandler;
