var SerialPort = require('serialport');
var xbee_api = require('xbee-api');
var C = xbee_api.constants;
require('dotenv').config()

// Définition des constantes LED pour le scope global
const LED_D1 = "D1";
const LED_D2 = "D2";
const LED_ON = 4;  // 4 = Digital High (0x04 en hex)
const LED_OFF = 0; // 0 = Digital Low (0x00 en hex)

const handleBac = require('./utils/chrono');
const mqtt = require('mqtt');
const mqttClient = mqtt.connect('mqtt://test.mosquitto.org');
const ButtonHandler = require('./utils/ButtonHandler');
const handleSeat = require('./utils/handleSeatSensor');
const config = require('./config');

mqttClient.on('connect', () => {
  console.log('✅ Connecté au broker MQTT');

  // S'abonner aux topics de commande pour toutes les tables
  mqttClient.subscribe('restaurant/tables/+/order_ready', (err) => {
    if (err) console.error('Erreur de souscription à order_ready:', err);
    else console.log('Abonné à restaurant/tables/+/order_ready');
  });
  
  mqttClient.subscribe('restaurant/tables/+/ready_to_order', (err) => {
    if (err) console.error('Erreur de souscription à ready_to_order:', err);
    else console.log('Abonné à restaurant/tables/+/ready_to_order');
  });

  // S'abonner aux autres topics nécessaires
  mqttClient.subscribe(config.mqtt.topics.sensorCommand, (err) => {
    if (err) console.error('Erreur de souscription:', err);
  });

  mqttClient.subscribe(config.mqtt.topics.moduleControl, (err) => {
    if (err) console.error('Erreur de souscription:', err);
  });
  
  // Gestionnaire global des messages MQTT
  mqttClient.on('message', (topic, message) => {
    try {
      // Extraire l'ID de table du topic
      let tableId = null;
      
      if (topic.startsWith('restaurant/tables/')) {
        const parts = topic.split('/');
        if (parts.length >= 3) {
          tableId = parseInt(parts[2], 10);
        }
      }
      
      // Si on a un ID de table valide
      if (tableId) {
        try {
          const data = JSON.parse(message.toString());
          
          // Vérifier si le message contient explicitement un ID de table différent
          const messageTableId = data.table || tableId;
          
          // Si le messageTableId est différent de tableId, utiliser celui du message
          if (messageTableId !== tableId) {
            tableId = messageTableId;
          }
          
          // Récupérer le XBee correspondant à cette table
          const xbeeConfig = XBEE_CONFIGS.find(cfg => cfg.tableId === tableId);
          
          if (!xbeeConfig) {
            console.log(`Aucun XBee configuré pour la Table ${tableId}`);
            return;
          }
          
          // Vérifier si on a déjà un gestionnaire pour cette table
          if (!global.buttonHandlers || !global.buttonHandlers[tableId]) {
            // Initialiser le handler
            if (!global.buttonHandlers) {
              global.buttonHandlers = {};
            }
            
            global.buttonHandlers[tableId] = new ButtonHandler(xbeeAPI, mqttClient);
            global.buttonHandlers[tableId].tableId = tableId;
            global.buttonHandlers[tableId].xbeeId = xbeeConfig.id;
          } else {
            // S'assurer que le handler existant utilise le bon XBee ID
            global.buttonHandlers[tableId].xbeeId = xbeeConfig.id;
          }
          
          // Traiter le message selon le type
          if (topic.endsWith('order_ready')) {
            console.log(`Ordre prêt reçu - Table ${tableId} - État: ${data.state}`);
            
            // Contrôle de la LED D2 (et réinitialisation de D1) pour order_ready
            if (data.state === 'on') {
              // Éteindre D1 d'abord (reset)
              global.buttonHandlers[tableId].directControlLED(LED_OFF, LED_D1);
              // Allumer D2
              global.buttonHandlers[tableId].directControlLED(LED_ON, LED_D2);
            } else {
              // Éteindre D1 d'abord (reset)
              global.buttonHandlers[tableId].directControlLED(LED_OFF, LED_D1);
              // Éteindre D2
              global.buttonHandlers[tableId].directControlLED(LED_OFF, LED_D2);
            }
            
            // Reset de l'état du bouton pour le prochain appui
            global.buttonHandlers[tableId].isLedOn = false;
            global.buttonHandlers[tableId].lastButtonState = 1;
          }
          else if (topic.endsWith('ready_to_order')) {
            console.log(`Prêt à commander reçu - Table ${tableId} - État: ${data.state}`);
            
            // Contrôle de la LED D1 pour ready_to_order
            if (data.state === 'on') {
              global.buttonHandlers[tableId].directControlLED(LED_ON, LED_D1);
            } else {
              global.buttonHandlers[tableId].directControlLED(LED_OFF, LED_D1);
            }
          }
        } catch (error) {
          console.error(`Erreur de traitement du message pour Table ${tableId}:`, error.message);
        }
      }
      // Autres types de messages MQTT
      else if (topic === config.mqtt.topics.moduleControl) {
        console.log("Message de contrôle de module reçu");
        // Traitement des messages de contrôle de module
      }
    } catch (error) {
      console.error('Erreur de traitement du message MQTT:', error.message);
    }
  });
});

if (!process.env.SERIAL_PORT)
  throw new Error('Missing SERIAL_PORT environment variable');

if (!process.env.SERIAL_BAUDRATE)
  throw new Error('Missing SERIAL_BAUDRATE environment variable');

// Replace with your serial port and baud rate (9600 by default)
const SERIAL_PORT = process.env.SERIAL_PORT;

// Ensure to configure your XBEE Module in API MODE 2 (comme indiqué dans le commentaire original)
var xbeeAPI = new xbee_api.XBeeAPI({
  api_mode: 2  // Changer de 1 à 2 pour correspondre au mode API des XBee
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

// Ne plus utiliser de buttonHandler global - SUPPRIMÉ

const BROADCAST_ADDRESS = "FFFFFFFFFFFFFFFF";

// Configuration des XBee
const XBEE_CONFIGS = [
  {
    id: "0013a20041fb6063",
    tableId: 1,
    description: "Table 1"
  },
  {
    id: "0013a20041a72946",
    tableId: 2,
    description: "Table 2"
  }
];

// Fonction pour obtenir l'ID de table à partir de l'adresse MAC XBee
function getTableIdFromXbeeId(xbeeId) {
  if (!xbeeId) return null;
  
  // Normaliser l'ID en minuscules pour la comparaison
  const normalizedId = xbeeId.toLowerCase();
  
  // Chercher la configuration correspondante
  const config = XBEE_CONFIGS.find(cfg => cfg.id.toLowerCase() === normalizedId);
  
  return config ? config.tableId : null;
}

// Fonction pour obtenir toutes les adresses MAC des XBee configurés
function getAllXbeeIds() {
  return XBEE_CONFIGS.map(cfg => cfg.id);
}

serialport.on("open", function () {
  console.log("Serial port opened successfully");
  
  // Fonction pour envoyer des commandes AT avec un délai entre elles
  function sendATCommandWithDelay(commands, index = 0) {
    if (index >= commands.length) {
      return;
    }
    
    const command = commands[index];
    xbeeAPI.builder.write(command);
    
    // Attendre 500ms avant d'envoyer la commande suivante
    setTimeout(() => {
      sendATCommandWithDelay(commands, index + 1);
    }, 300);
  }
  
  // Préparer les commandes pour tous les XBee
  const allCommands = [];
  
  XBEE_CONFIGS.forEach(xbeeConfig => {
    console.log(`Preparing configuration for ${xbeeConfig.description} (${xbeeConfig.id})`);
    
    // Configurer D0 comme entrée numérique avec pull-up (mode 3)
    allCommands.push({
      type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
      destination64: xbeeConfig.id,
      command: "D0",
      commandParameter: [3], // 3 = Digital Input avec pull-up
    });
    
    // Configurer la détection de changement (IC)
    allCommands.push({
      type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
      destination64: xbeeConfig.id,
      command: "IC",
      commandParameter: [1], // Activer la détection de changement sur D0
    });
    
    // Désactiver l'échantillonnage périodique
    allCommands.push({
      type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
      destination64: xbeeConfig.id,
      command: "IR", 
      commandParameter: [0, 0], // Désactiver l'échantillonnage périodique
    });
    
    // Sauvegarder et appliquer les paramètres
    allCommands.push({
      type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
      destination64: xbeeConfig.id,
      command: "AC", // Apply Changes
      commandParameter: [],
    });
  });
  
  // Envoyer les commandes
  sendATCommandWithDelay(allCommands);

  // Identifier tous les modules XBee après un délai
  setTimeout(() => {
    var localNI = {
      type: C.FRAME_TYPE.AT_COMMAND,
      command: "NI",
      commandParameter: [],
    };
    xbeeAPI.builder.write(localNI);
    
    var remoteNI = {
      type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
      destination64: BROADCAST_ADDRESS,
      command: "NI",
      commandParameter: [],
    };
    xbeeAPI.builder.write(remoteNI);
  }, 5000); // 5 secondes après l'initialisation
});

// All frames parsed by the XBee will be emitted here
xbeeAPI.parser.on("data", function (frame) {
  // Ne pas afficher tous les types de trames, seulement les informations importantes
  
  // Obtenir l'ID de table à partir de l'adresse XBee (si disponible)
  let tableId = null;
  if (frame.remote64) {
    tableId = getTableIdFromXbeeId(frame.remote64);
  }

  // Récupérer la valeur des entrées analogiques
  const analogValueAD0 = frame.analogSamples?.AD0;
  const analogValueAD1 = frame.analogSamples?.AD1;
  const analogValueAD2 = frame.analogSamples?.AD2;

  // Si c'est une commande de réponse, pas besoin d'en faire tout un log
  if (frame.type === C.FRAME_TYPE.REMOTE_COMMAND_RESPONSE) {
    // Afficher uniquement les erreurs
    if (frame.commandStatus !== 0) {
      console.log(`Erreur commande ${frame.command} sur XBee ${frame.remote64}: status ${frame.commandStatus}`);
    }
    return;
  }

  // Handle button state changes if frame is from a recognized XBee
  if (frame.type === xbee_api.constants.FRAME_TYPE.ZIGBEE_IO_DATA_SAMPLE_RX) {
    // Vérifier si c'est un de nos appareils XBee configurés
    if (frame.remote64 && tableId) {
      // Récupérer la configuration de ce XBee
      const xbeeConfig = XBEE_CONFIGS.find(cfg => cfg.id.toLowerCase() === frame.remote64.toLowerCase());
      if (!xbeeConfig) {
        return;
      }
      
      // Récupérer l'ID de table de la configuration
      const configTableId = xbeeConfig.tableId;
      if (configTableId !== tableId) {
        tableId = configTableId;
      }
      
      // Handle button state depending on whether we're looking for D0 or DIO0
      // Check both possibilities (some XBee modules report as D0, others as DIO0)
      let buttonState;
      if (frame.digitalSamples && frame.digitalSamples.D0 !== undefined) {
        buttonState = frame.digitalSamples.D0;
        if (buttonState === 0) { // Seulement log quand le bouton est appuyé
          console.log(`🔘 BOUTON APPUYÉ - Table ${tableId}`);
        }
        handleButtonForTable(buttonState, tableId, frame.remote64);
      } 
      else if (frame.digitalSamples && frame.digitalSamples.DIO0 !== undefined) {
        buttonState = frame.digitalSamples.DIO0;
        if (buttonState === 0) { // Seulement log quand le bouton est appuyé
          console.log(`🔘 BOUTON APPUYÉ - Table ${tableId}`);
        }
        handleButtonForTable(buttonState, tableId, frame.remote64);
      }
      
      // Traiter les données des capteurs analogiques
      if (analogValueAD2 !== undefined) {
        console.log(`AD2 Value (Table ${tableId}): ${analogValueAD2}`);
        handleSeat(analogValueAD2, mqttClient, `AD2_Table${tableId}`);
      }
    }
  }
});

// Fonction pour gérer l'état du bouton en fonction de la table
function handleButtonForTable(buttonState, tableId, xbeeId) {
  // Si table inconnue, ne rien faire
  if (!tableId) return;
  
  // Récupérer la configuration XBee correspondant à cette table
  const xbeeConfig = XBEE_CONFIGS.find(cfg => cfg.tableId === tableId);
  if (!xbeeConfig) {
    console.log(`Aucun XBee configuré pour la Table ${tableId}`);
    return;
  }
  
  // Créer un buttonHandler spécifique à la table si nécessaire
  if (!global.buttonHandlers) {
    global.buttonHandlers = {};
  }
  
  if (!global.buttonHandlers[tableId]) {
    console.log(`Initialisation du ButtonHandler pour la Table ${tableId}`);
    global.buttonHandlers[tableId] = new ButtonHandler(xbeeAPI, mqttClient);
    
    // Stocker l'ID de table pour les publications MQTT
    global.buttonHandlers[tableId].tableId = tableId;
    
    // IMPORTANT: Utiliser l'ID XBee correspondant à cette table
    global.buttonHandlers[tableId].xbeeId = xbeeConfig.id;
    console.log(`Table ${tableId} associée au XBee: ${xbeeConfig.id}`);
  }
  
  // Utiliser le ButtonHandler spécifique à cette table
  global.buttonHandlers[tableId].handleButtonState(buttonState, xbeeId);
}
