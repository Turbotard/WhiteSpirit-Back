var SerialPort = require('serialport');
var xbee_api = require('xbee-api');
var C = xbee_api.constants;
require('dotenv').config()

const handleVerre = require('./utils/chrono');
const mqtt = require('mqtt');
const mqttClient = mqtt.connect('mqtt://localhost:1883');

mqttClient.on('connect', () => {
  console.log('✅ Connecté au broker MQTT');
});

// LED Control constants
const LED_D1 = "D1";
const LED_D2 = "D2";
const LED_D3 = "D3";
const LED_ON = "04";
const LED_OFF = "00";
let currentLED = 0;
const leds = [LED_D1, LED_D2, LED_D3];

// Button debounce
let lastButtonState = 1; // Initialize to 1 (not pressed) since button is pull-up
let lastDebounceTime = 0;
const debounceDelay = 50; // 50ms debounce time
let buttonPressed = false;
let buttonPressStartTime = 0;
const longPressDelay = 1000; // 1 second for long press

// Function to send command to control LED
function controlLED(led, state) {
  console.log(`Sending command: LED ${led} -> ${state}`);
  const frame_obj = {
    type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
    destination64: "0013A20041C345D2",
    command: led,
    commandParameter: [state],
  };
  xbeeAPI.builder.write(frame_obj);
}

// Function to change to next LED
function changeToNextLED() {
  console.log(`Changing LED: Current LED is ${leds[currentLED]}`);
  // Turn off current LED
  controlLED(leds[currentLED], LED_OFF);
  
  // Move to next LED and turn it on
  currentLED = (currentLED + 1) % leds.length;
  console.log(`New LED will be ${leds[currentLED]}`);
  controlLED(leds[currentLED], LED_ON);
}

// Function to turn off current LED
function turnOffCurrentLED() {
  console.log(`Turning off LED ${leds[currentLED]}`);
  controlLED(leds[currentLED], LED_OFF);
}

if (!process.env.SERIAL_PORT)
  throw new Error('Missing SERIAL_PORT environment variable');

if (!process.env.SERIAL_BAUDRATE)
  throw new Error('Missing SERIAL_BAUDRATE environment variable');

// Replace with your serial port and baud rate (9600 by default)
const SERIAL_PORT = process.env.SERIAL_PORT;

// Ensure to configure your XBEE Module in API MODE 2
var xbeeAPI = new xbee_api.XBeeAPI({
  api_mode: 2
});

let serialport = new SerialPort(SERIAL_PORT, {
  baudRate: parseInt(process.env.SERIAL_BAUDRATE) || 9600,
}, function (err) {
  if (err) {
    return console.log('Creating SerialPort', err.message)
  }
});

serialport.pipe(xbeeAPI.parser);
xbeeAPI.builder.pipe(serialport);

const BROADCAST_ADDRESS = "FFFFFFFFFFFFFFFF";
serialport.on("open", function () {

  //Sample local command to ask local Xbee module the value of NODE IDENTIFIER
  var frame_obj = { // AT Request to be sent
    type: C.FRAME_TYPE.AT_COMMAND,
    command: "NI",
    commandParameter: [],
  };

  xbeeAPI.builder.write(frame_obj);

  //Sample remote command to ask all remote Xbee modules the value of their NODE IDENTIFIER
  frame_obj = { // AT Request to be sent
    type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
    destination64: BROADCAST_ADDRESS,
    command: "NI",
    commandParameter: [],
  };
  xbeeAPI.builder.write(frame_obj);

});

// All frames parsed by the XBee will be emitted here
xbeeAPI.parser.on("data", function (frame) {

  //on new device is joined, register it
  if (C.FRAME_TYPE.JOIN_NOTIFICATION_STATUS === frame.type) {
    console.log("New device has joined network, you can register has new device available");

  }

  if (C.FRAME_TYPE.ZIGBEE_RECEIVE_PACKET === frame.type) {
    console.log("C.FRAME_TYPE.ZIGBEE_RECEIVE_PACKET");
    let dataReceived = String.fromCharCode.apply(null, frame.data);
    console.log(">> ZIGBEE_RECEIVE_PACKET >", dataReceived);

  }

  if (C.FRAME_TYPE.NODE_IDENTIFICATION === frame.type) {
    // let dataReceived = String.fromCharCode.apply(null, frame.nodeIdentifier);
    console.log("NODE_IDENTIFICATION");

  } else if (C.FRAME_TYPE.ZIGBEE_IO_DATA_SAMPLE_RX === frame.type) {

    console.log("ZIGBEE_IO_DATA_SAMPLE_RX")
    console.log(frame)
    console.log("Value of ADO can be retrieved with frame.analogSamples.AD0")
    console.log(frame.analogSamples.AD0)

    const analogValue = frame.analogSamples?.AD0;
    if (analogValue !== undefined) {
      handleVerre(analogValue, mqttClient);
    }

  } else if (C.FRAME_TYPE.REMOTE_COMMAND_RESPONSE === frame.type) {
    console.log("REMOTE_COMMAND_RESPONSE")
  } else {
    console.debug(frame);
    let dataReceived = String.fromCharCode.apply(null, frame.commandData)
    console.log(dataReceived);
  }

});
