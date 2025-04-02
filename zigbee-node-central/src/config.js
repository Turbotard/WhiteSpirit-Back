require('dotenv').config();

module.exports = {
  // Configuration du port série
  serial: {
    port: process.env.SERIAL_PORT,
    baudRate: parseInt(process.env.SERIAL_BAUDRATE) || 9600
  },

  // Configuration MQTT
  mqtt: {
    brokerUrl: process.env.MQTT_BROKER_URL,
    clientId: process.env.MQTT_CLIENT_ID,
    topics: {
      sensorData: process.env.MQTT_TOPIC_SENSOR_DATA,
      sensorStatus: process.env.MQTT_TOPIC_SENSOR_STATUS,
      sensorCommand: process.env.MQTT_TOPIC_SENSOR_COMMAND,
      moduleControl: process.env.MQTT_TOPIC_MODULE_CONTROL,
      moduleStatus: process.env.MQTT_TOPIC_MODULE_STATUS
    }
  },

  // Configuration XBee
  xbee: {
    apiMode: parseInt(process.env.XBEE_API_MODE) || 2,
    broadcastAddress: process.env.XBEE_BROADCAST_ADDRESS
  },

  // Configuration des capteurs
  sensors: {
    temperature: {
      id: process.env.SENSOR_TEMPERATURE_ID,
      type: 'temperature',
      unit: '°C'
    },
    humidity: {
      id: process.env.SENSOR_HUMIDITY_ID,
      type: 'humidity',
      unit: '%'
    },
    pressure: {
      id: process.env.SENSOR_PRESSURE_ID,
      type: 'pressure',
      unit: 'hPa'
    }
  },

  // Commandes disponibles pour les capteurs
  commands: {
    temperature: ['READ_TEMP', 'SET_INTERVAL'],
    humidity: ['READ_HUM', 'SET_INTERVAL'],
    pressure: ['READ_PRESS', 'SET_INTERVAL'],
    common: ['RESET', 'GET_STATUS', 'GET_CONFIG']
  }
};
