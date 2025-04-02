var SerialPort = require('serialport');
var xbee_api = require('xbee-api');
var C = xbee_api.constants;
require('dotenv').config()

const handleBac = require('./utils/chrono');
const mqtt = require('mqtt');
const mqttClient = mqtt.connect('mqtt://test.mosquitto.org');
const ButtonHandler = require('./utils/ButtonHandler');
const config = require('./config');

mqttClient.on('connect', () => {
  console.log('✅ Connecté au broker MQTT');

  // S'abonner aux topics de commande
  mqttClient.subscribe(config.mqtt.topics.sensorCommand, (err) => {
    if (err) console.error('Erreur de souscription:', err);
  });

  mqttClient.subscribe(config.mqtt.topics.moduleControl, (err) => {
    if (err) console.error('Erreur de souscription:', err);
  });
});

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

// Create button handler AFTER xbeeAPI is initialized
const buttonHandler = new ButtonHandler(xbeeAPI, mqttClient);

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
  // on new device is joined, register it
  if (C.FRAME_TYPE.JOIN_NOTIFICATION_STATUS === frame.type) {
    console.log("New device has joined network, you can register new device available");
  }

  if (C.FRAME_TYPE.ZIGBEE_RECEIVE_PACKET === frame.type) {
    console.log("C.FRAME_TYPE.ZIGBEE_RECEIVE_PACKET");
    let dataReceived = String.fromCharCode.apply(null, frame.data);
    console.log(">> ZIGBEE_RECEIVE_PACKET >", dataReceived);
  }

  if (C.FRAME_TYPE.NODE_IDENTIFICATION === frame.type) {
    console.log("NODE_IDENTIFICATION");
  } else if (C.FRAME_TYPE.ZIGBEE_IO_DATA_SAMPLE_RX === frame.type) {
    console.log("ZIGBEE_IO_DATA_SAMPLE_RX");
    console.log(frame);

    // Récupérer la valeur de AD0 et AD1
    const analogValueAD0 = frame.analogSamples?.AD0;
    const analogValueAD1 = frame.analogSamples?.AD1;

    // Si AD0 est défini, appelle la fonction handleBac
    if (analogValueAD0 !== undefined) {
      console.log("AD0 Value:", analogValueAD0);
      handleBac(analogValueAD0, mqttClient, 'AD0'); // Passe un paramètre pour savoir d'où vient la valeur
    }

    // Si AD1 est défini, appelle la fonction handleBac
    if (analogValueAD1 !== undefined) {
      console.log("AD1 Value:", analogValueAD1);
      handleBac(analogValueAD1, mqttClient, 'AD1'); // Passe un paramètre pour savoir d'où vient la valeur
    }

    // Handle button state if DIO0 is present
    if (frame.digitalSamples && frame.digitalSamples.DIO0 !== undefined) {
      buttonHandler.handleButtonState(frame.digitalSamples.DIO0);
    }
  } else if (C.FRAME_TYPE.REMOTE_COMMAND_RESPONSE === frame.type) {
    console.log("REMOTE_COMMAND_RESPONSE");
  } else {
    console.debug(frame);
    let dataReceived = String.fromCharCode.apply(null, frame.commandData);
    console.log(dataReceived);
  }
});
