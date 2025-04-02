const generateRestaurantUrl = require('./sender');

module.exports = function handleBac(analogValue, mqttClient) {
  if (!global.timerState) {
    global.timerState = {
      countdownTimer: null,
      currentSeconds: 10,
      verrePresent: false,
      compteAReboursTermine: false
    };
  }

  const state = global.timerState;

  if (analogValue > 200) {
    if (!state.verrePresent && !state.compteAReboursTermine) {
      state.verrePresent = true;
      state.currentSeconds = 10;
      console.log("bac détecté, démarrage du compte à rebours...");

      mqttClient.publish(generateRestaurantUrl("buffet", 1, "active"), "true");

      state.countdownTimer = setInterval(() => {
        console.log(`⏳ Temps restant : ${state.currentSeconds}s`);
        
        mqttClient.publish(generateRestaurantUrl("buffet", 1, "timer"), state.currentSeconds.toString());

        state.currentSeconds--;

        if (state.currentSeconds < 0) {
          console.log("temps écoulé");
          
          mqttClient.publish(generateRestaurantUrl("buffet", 1, "active"), "false");

          clearInterval(state.countdownTimer);
          state.countdownTimer = null;
          state.compteAReboursTermine = true;
        }
      }, 1000);
    }
  } else {
    if (state.verrePresent || state.compteAReboursTermine) {
      console.log("❌ bac retiré, réinitialisation...");
      
      mqttClient.publish(generateRestaurantUrl("buffet", 1, "active"), "false");

      clearInterval(state.countdownTimer);
      state.countdownTimer = null;
      state.currentSeconds = 10;
      state.verrePresent = false;
      state.compteAReboursTermine = false;
    }
  }
}
