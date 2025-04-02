const xbee_api = require('xbee-api');
const C = xbee_api.constants;

// LED Control constants
const LED_D1 = "D1";
const LED_D2 = "D2";
const LED_D3 = "D3";
const LED_ON = "04";
const LED_OFF = "00";

class ButtonHandler {
  constructor(xbeeAPI, mqttClient) {
    this.xbeeAPI = xbeeAPI;
    this.mqttClient = mqttClient;
    this.currentLED = 0;
    this.leds = [LED_D1, LED_D2, LED_D3];
    
    // Button debounce
    this.lastButtonState = 1; // Initialize to 1 (not pressed) since button is pull-up
    this.buttonPressed = false;
    this.buttonPressStartTime = 0;
    this.longPressDelay = 1000; // 1 second for long press
  }

  // Function to send command to control LED
  controlLED(led, state) {
    console.log(`Sending command: LED ${led} -> ${state}`);
    const frame_obj = {
      type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
      destination64: "0013A20041C345D2",
      command: led,
      commandParameter: [state],
    };
    this.xbeeAPI.builder.write(frame_obj);
    
    // Publish LED state to MQTT
    if (this.mqttClient) {
      this.mqttClient.publish('zigbee/led/state', JSON.stringify({
        led: led,
        state: state === LED_ON ? 'on' : 'off'
      }));
    }
  }

  // Function to change to next LED
  changeToNextLED() {
    console.log(`Changing LED: Current LED is ${this.leds[this.currentLED]}`);
    // Turn off current LED
    this.controlLED(this.leds[this.currentLED], LED_OFF);
    
    // Move to next LED and turn it on
    this.currentLED = (this.currentLED + 1) % this.leds.length;
    console.log(`New LED will be ${this.leds[this.currentLED]}`);
    this.controlLED(this.leds[this.currentLED], LED_ON);
    
    // Publish LED change to MQTT
    if (this.mqttClient) {
      this.mqttClient.publish('zigbee/led/current', JSON.stringify({
        currentLED: this.currentLED,
        ledName: this.leds[this.currentLED]
      }));
    }
  }

  // Function to turn off current LED
  turnOffCurrentLED() {
    console.log(`Turning off LED ${this.leds[this.currentLED]}`);
    this.controlLED(this.leds[this.currentLED], LED_OFF);
    
    // Publish LED off to MQTT
    if (this.mqttClient) {
      this.mqttClient.publish('zigbee/led/current', JSON.stringify({
        currentLED: this.currentLED,
        ledName: this.leds[this.currentLED],
        state: 'off'
      }));
    }
  }

  // Handle button state change
  handleButtonState(buttonState) {
    console.log(`Button state: ${buttonState}, Last state: ${this.lastButtonState}, Button pressed: ${this.buttonPressed}`);
    
    // Detect button release (transition from 0 to 1)
    if (buttonState === 1 && this.lastButtonState === 0) {
      console.log("Button released - starting timer!");
      this.buttonPressStartTime = Date.now();
      this.buttonPressed = true;
      
      // Publish button release to MQTT
      if (this.mqttClient) {
        this.mqttClient.publish('zigbee/button/event', JSON.stringify({
          event: 'released',
          timestamp: Date.now()
        }));
      }
    }
    // Detect button press (transition from 1 to 0)
    else if (buttonState === 0 && this.lastButtonState === 1 && this.buttonPressed) {
      const waitDuration = Date.now() - this.buttonPressStartTime;
      console.log(`Button pressed after waiting ${waitDuration}ms`);
      
      // Publish button press to MQTT
      if (this.mqttClient) {
        this.mqttClient.publish('zigbee/button/event', JSON.stringify({
          event: 'pressed',
          waitDuration: waitDuration,
          isLongPress: waitDuration >= this.longPressDelay,
          timestamp: Date.now()
        }));
      }
      
      if (waitDuration >= this.longPressDelay) {
        console.log("Long wait detected - turning off LED");
        this.turnOffCurrentLED();
      } else {
        console.log("Short wait detected - changing LED");
        this.changeToNextLED();
      }
      this.buttonPressed = false;
    }
    
    this.lastButtonState = buttonState;
  }
}

module.exports = ButtonHandler;
