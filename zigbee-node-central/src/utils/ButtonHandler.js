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
    
    // Flags to prevent message loops
    this.processingReadyToOrder = false;
    this.processingOrderReady = false;

    // Configure LED on startup
    this.configureLED();

    // Subscribe to MQTT topics
    // Topic for web-initiated orders (controls D2)
    this.mqttClient.subscribe('restaurant/tables/+/order_ready');
    // Topic for button-initiated ready signal (controls D1)
    this.mqttClient.subscribe('restaurant/tables/+/ready_to_order');
    
    this.mqttClient.on('message', (topic, message) => {
      if (topic.includes('order_ready') && !this.processingOrderReady) {
        console.log("Received order_ready message from web");
        this.handleOrderReady(topic, message);
      } else if (topic.includes('ready_to_order') && !this.processingReadyToOrder) {
        console.log("Received ready_to_order message from button");
        this.handleReadyToOrder(topic, message);
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
  controlLED(state, ledPin = LED_D1, publishMqtt = true) {
    console.log(`Sending command: LED ${ledPin} -> ${state}`);
    const frame_obj = {
      type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
      destination64: "0013a20041fb6063",
      command: ledPin,
      commandParameter: [state],
    };
    console.log("Frame object:", JSON.stringify(frame_obj, null, 2));
    this.xbeeAPI.builder.write(frame_obj);
    console.log("Command sent to XBee");
    
    // Only publish MQTT if specified
    if (publishMqtt && this.mqttClient) {
      this.mqttClient.publish('restaurant/tables/{id_table}/ready_to_order', JSON.stringify({
        led: ledPin,
        state: state === LED_ON ? 'on' : 'off'
      }));
    }
  }

  // Handle order_ready message (from web, controls D2)
  handleOrderReady(topic, message) {
    console.log("Handling order_ready message (web -> D2)");
    try {
      // Set flag to prevent loops
      this.processingOrderReady = true;
      
      const data = JSON.parse(message.toString());
      console.log("Message data:", data);
      
      // Always use D2 for order_ready messages
      if (data.state === 'on') {
        this.controlLED(LED_ON, LED_D2);
      } else {
        this.controlLED(LED_OFF, LED_D2);
      }
      
      // Reset flag after processing
      setTimeout(() => {
        this.processingOrderReady = false;
      }, 500);
    } catch (error) {
      console.error("Error parsing order_ready message:", error);
      this.controlLED(LED_OFF, LED_D2);
      this.processingOrderReady = false;
    }
  }

  // Handle ready_to_order message (from button, controls D1)
  handleReadyToOrder(topic, message) {
    console.log("Handling ready_to_order message (button -> D1)");
    try {
      // Set flag to prevent loops
      this.processingReadyToOrder = true;
      
      const data = JSON.parse(message.toString());
      console.log("Message data:", data);
      
      // Always use D1 for ready_to_order messages
      if (data.state === 'on') {
        this.controlLED(LED_ON, LED_D1, false); // Don't publish MQTT in controlLED
      } else {
        this.controlLED(LED_OFF, LED_D1, false); // Don't publish MQTT in controlLED
      }
      
      // Reset flag after processing
      setTimeout(() => {
        this.processingReadyToOrder = false;
      }, 500);
    } catch (error) {
      console.error("Error parsing ready_to_order message:", error);
      this.controlLED(LED_OFF, LED_D1, false);
      this.processingReadyToOrder = false;
    }
  }

  // Handle button state change
  handleButtonState(buttonState) {
    console.log(`Button state: ${buttonState}, Last state: ${this.lastButtonState}`);
    
    // Detect button press (transition from 1 to 0)
    if (buttonState === 0 && this.lastButtonState === 1 && !this.buttonPressed) {
      console.log("Button pressed - toggling LED D1 only");
      
      // Set flag to prevent multiple presses
      this.buttonPressed = true;
      
      // Toggle LED state
      this.isLedOn = !this.isLedOn;
      
      // Set flag to prevent loops
      this.processingReadyToOrder = true;
      
      // Control LED D1 directly without publishing MQTT
      this.controlLED(this.isLedOn ? LED_ON : LED_OFF, LED_D1, false);
      
      // Publish to ready_to_order topic only once
      if (this.mqttClient) {
        this.mqttClient.publish('restaurant/tables/{id_table}/ready_to_order', JSON.stringify({
          led: LED_D1,
          state: this.isLedOn ? 'on' : 'off'
        }));
      }
      
      // Reset flag after a delay
      setTimeout(() => {
        this.buttonPressed = false;
        this.processingReadyToOrder = false;
      }, 500);
    }
    
    this.lastButtonState = buttonState;
  }
}

module.exports = ButtonHandler;
