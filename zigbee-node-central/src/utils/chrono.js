const generateRestaurantUrl = require('./sender');


module.exports = function handleVerre(analogValue, mqttClient) {
    if (!global.timerState) {
      global.timerState = {
        countdownTimer: null,
        currentSeconds: 20,
        verrePresent: false,
        compteAReboursTermine: false
      };
    }
  
    const state = global.timerState;
  
    if (analogValue > 200) {
      if (!state.verrePresent && !state.compteAReboursTermine) {
        state.verrePresent = true;
        state.currentSeconds = 20;
        console.log("Verre détecté, démarrage du compte à rebours...");
        const url = generateRestaurantUrl("table", 1, "timer")

        console.log(url)
        mqttClient.publish('capteur/verre', 'present');
  
        state.countdownTimer = setInterval(() => {
          console.log(`⏳ Temps restant : ${state.currentSeconds}s`);
          mqttClient.publish(url, state.currentSeconds.toString());
          state.currentSeconds--;
  
          if (state.currentSeconds < 0) {
            console.log("⏱️ 20 secondes écoulées → STOP !");
            mqttClient.publish('capteur/verre/chrono', '0');
            clearInterval(state.countdownTimer);
            state.countdownTimer = null;
            state.compteAReboursTermine = true;
          }
        }, 1000);
      }
    } else {
      if (state.verrePresent || state.compteAReboursTermine) {
        console.log("❌ Verre retiré, réinitialisation...");
        mqttClient.publish('capteur/verre', 'absent');
        clearInterval(state.countdownTimer);
        state.countdownTimer = null;
        state.currentSeconds = 20;
        state.verrePresent = false;
        state.compteAReboursTermine = false;
      }
    }
  }
  