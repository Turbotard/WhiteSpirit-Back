var SerialPort = require('serialport');
var xbee_api = require('xbee-api');
var C = xbee_api.constants;
require('dotenv').config()

const handleVerre = require('./utils/chrono');
const mqtt = require('mqtt');
const mqttClient = mqtt.connect('mqtt://localhost:1883');
const ButtonHandler = require('./utils/ButtonHandler');

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
    console.log("NODE_IDENTIFICATION");
  } else if (C.FRAME_TYPE.ZIGBEE_IO_DATA_SAMPLE_RX === frame.type) {
    console.log("ZIGBEE_IO_DATA_SAMPLE_RX");
    console.log(frame);

    const analogValue = frame.analogSamples?.AD0;
    if (analogValue !== undefined) {
      handleVerre(analogValue, mqttClient);
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

// Fonction de publication MQTT
function publishSensorData(sensorId, data) {
  const payload = JSON.stringify({
    sensorId,
    timestamp: new Date().toISOString(),
    data
  });

  mqttClient.publish('sensors/data', payload, (err) => {
    if (err) console.error('Erreur de publication:', err);
  });
}

function publishModuleStatus(moduleId, status) {
  const payload = JSON.stringify({
    moduleId,
    timestamp: new Date().toISOString(),
    status
  });

  mqttClient.publish('modules/status', payload, (err) => {
    if (err) console.error('Erreur de publication:', err);
  });
}

// Gestion des messages MQTT
mqttClient.on('message', (topic, message) => {
  console.log(`Message reçu sur ${topic}: ${message.toString()}`);

  if (topic === config.mqtt.topics.sensorCommand) {
    handleSensorCommand(message.toString());
  } else if (topic === config.mqtt.topics.moduleControl) {
    handleModuleControl(message.toString());
  }
});

// Fonctions de gestion des commandes
function handleSensorCommand(message) {
  try {
    const command = JSON.parse(message);
    console.log('Commande reçue pour le capteur:', command);

    // Vérifier si la commande est valide pour ce type de capteur
    const sensorType = Object.keys(config.sensors).find(
      type => config.sensors[type].id === command.sensorId
    );

    if (!sensorType) {
      throw new Error(`Capteur inconnu: ${command.sensorId}`);
    }

    if (!config.commands[sensorType].includes(command.command) &&
        !config.commands.common.includes(command.command)) {
      throw new Error(`Commande invalide pour ce capteur: ${command.command}`);
    }

    // Construire et envoyer la trame XBee
    const frame_obj = {
      type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
      destination64: command.sensorId,
      command: command.command.toUpperCase(),
      commandParameter: command.parameters || []
    };

    xbeeAPI.builder.write(frame_obj);

    // Publier le statut
    publishModuleStatus(command.sensorId, {
      status: 'command_sent',
      command: command.command,
      sensorType: sensorType
    });
  } catch (error) {
    console.error('Erreur lors du traitement de la commande:', error);
    publishModuleStatus(command.sensorId, {
      status: 'error',
      error: error.message
    });
  }
}

function handleModuleControl(message) {
  try {
    const command = JSON.parse(message);
    console.log('Commande de contrôle reçue:', command);

    if (command.action === 'CHECK_AVAILABILITY') {
      if (!systemState.serialConnected) {
        // Si le port série n'est pas connecté, renvoyer l'état actuel
        publishModuleStatus('system', {
          status: 'sensor_availability',
          serialConnected: false,
          sensors: systemState.sensors
        });
        return;
      }

      // Vérifier tous les capteurs
      checkAllSensors().then(sensors => {
        systemState.sensors = sensors;
        publishModuleStatus('system', {
          status: 'sensor_availability',
          serialConnected: true,
          sensors: sensors
        });
      });
      return;
    }

    console.log("ZIGBEE_IO_DATA_SAMPLE_RX")
    console.log(frame)

    const analogValue = frame.analogSamples?.AD0;
    if (analogValue !== undefined) {
      handleVerre(analogValue, mqttClient);
    }

    // Handle button state if DIO0 is present
    if (frame.digitalSamples && frame.digitalSamples.DIO0 !== undefined) {
      buttonHandler.handleButtonState(frame.digitalSamples.DIO0);
    }

    const frame_obj = {
      type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
      destination64: command.moduleId,
      command: command.action.toUpperCase(),
      commandParameter: command.parameters || []
    };

    xbeeAPI.builder.write(frame_obj);

    publishModuleStatus(command.moduleId, {
      status: 'control_command_sent',
      action: command.action
    });
  } catch (error) {
    console.error('Erreur lors du traitement de la commande de contrôle:', error);
  }
}

// Gestionnaire d'état des capteurs
const sensorStatus = new Map();

// Fonction pour vérifier la disponibilité d'un capteur
function checkSensorAvailability(sensorId) {
  return new Promise((resolve) => {
    // Envoyer une commande de test
    const frame_obj = {
      type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
      destination64: sensorId,
      command: "NI", // Node Identifier
      commandParameter: []
    };

    // Définir un timeout
    const timeout = setTimeout(() => {
      sensorStatus.set(sensorId, { available: false, lastCheck: new Date() });
      resolve(false);
    }, 2000); // 2 secondes de timeout

    // Écouter la réponse
    const responseHandler = (frame) => {
      if (frame.type === C.FRAME_TYPE.REMOTE_COMMAND_RESPONSE &&
          frame.remote64 === sensorId) {
        clearTimeout(timeout);
        xbeeAPI.parser.removeListener('data', responseHandler);
        sensorStatus.set(sensorId, {
          available: true,
          lastCheck: new Date(),
          nodeId: String.fromCharCode.apply(null, frame.commandData)
        });
        resolve(true);
      }
    };

    xbeeAPI.parser.on('data', responseHandler);
    xbeeAPI.builder.write(frame_obj);
  });
}

// Fonction pour vérifier tous les capteurs
async function checkAllSensors() {
  const results = {};
  for (const [type, sensor] of Object.entries(config.sensors)) {
    results[type] = {
      ...sensor,
      available: await checkSensorAvailability(sensor.id)
    };
  }
  return results;
}
