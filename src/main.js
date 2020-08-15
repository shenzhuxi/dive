/**
 * @author Mugen87 / https://github.com/Mugen87
 */

import world from './core/World.js';

const startButton = document.getElementById( 'start' );
startButton.addEventListener( 'click', () => {

	const startScreen = document.getElementById( 'startScreen' );
	startScreen.remove();

	world.init();

} );

/**
 * Oculus Browser messed up with the requestIdleCallback. 
 * https://gist.github.com/paullewis/55efe5d6f05434a96c36
 */

window.requestIdleCallback = function (cb) {
    return setTimeout(function () {
      var start = Date.now();
      cb({ 
        didTimeout: false,
        timeRemaining: function () {
          return Math.max(0, 50 - (Date.now() - start));
        }
      });
    }, 1);
  }

window.cancelIdleCallback = function (id) {
    clearTimeout(id);
  } 
