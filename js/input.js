/* NEON OUTBREAK - keyboard, mouse and touch input */
(function () {
  'use strict';

  const NO = (window.NO = window.NO || {});
  const gameKeys = new Set([
    'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Space', 'Escape', 'KeyM', 'Digit1', 'Digit2', 'Digit3', 'Enter'
  ]);

  const Input = {
    keys: Object.create(null),
    pressed: Object.create(null),
    touchVector: { x: 0, y: 0 },
    touchActive: false,
    joystick: null,
    knob: null,
    joystickPointer: null,
    joystickRect: null,
    dashButton: null,
    touchMode: false,
    initialized: false,

    init: function () {
      if (this.initialized) return;
      this.initialized = true;

      this.touchMode = NO.Utils.isTouchDevice();
      if (this.touchMode) document.body.classList.add('touch-device');

      const self = this;
      window.addEventListener('keydown', function (event) {
        if (gameKeys.has(event.code)) {
          if (event.code === 'Space' || event.code === 'Enter' || event.code.indexOf('Arrow') === 0) event.preventDefault();
          if (!event.repeat) self.pressed[event.code] = true;
          self.keys[event.code] = true;
        }
      }, { passive: false });

      window.addEventListener('keyup', function (event) {
        if (gameKeys.has(event.code)) {
          self.keys[event.code] = false;
          if (event.code === 'Space' || event.code === 'Enter' || event.code.indexOf('Arrow') === 0) event.preventDefault();
        }
      }, { passive: false });

      window.addEventListener('blur', function () { self.clearKeys(); });
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
          self.clearKeys();
          self.resetJoystick();
        }
      });

      document.addEventListener('touchstart', function () {
        if (!self.touchMode) {
          self.touchMode = true;
          document.body.classList.add('touch-device');
        }
      }, { passive: true });

      this.setupJoystick();
      this.setupDashButton();
    },

    setupJoystick: function () {
      this.joystick = document.getElementById('joystick');
      this.knob = document.getElementById('joystick-knob');
      if (!this.joystick || !this.knob) return;
      const self = this;

      const onDown = function (event) {
        if (self.joystickPointer !== null) return;
        event.preventDefault();
        self.joystickPointer = event.pointerId;
        self.touchActive = true;
        try { self.joystick.setPointerCapture(event.pointerId); } catch (error) { /* ignore */ }
        self.joystickRect = self.joystick.getBoundingClientRect();
        self.updateJoystick(event.clientX, event.clientY);
      };

      const onMove = function (event) {
        if (self.joystickPointer !== event.pointerId) return;
        event.preventDefault();
        self.updateJoystick(event.clientX, event.clientY);
      };

      const onUp = function (event) {
        if (self.joystickPointer !== event.pointerId && self.joystickPointer !== null) return;
        event.preventDefault();
        self.joystickPointer = null;
        self.touchActive = false;
        self.touchVector.x = 0;
        self.touchVector.y = 0;
        self.knob.style.transform = 'translate(0px, 0px)';
      };

      this.joystick.addEventListener('pointerdown', onDown, { passive: false });
      this.joystick.addEventListener('pointermove', onMove, { passive: false });
      this.joystick.addEventListener('pointerup', onUp, { passive: false });
      this.joystick.addEventListener('pointercancel', onUp, { passive: false });
      this.joystick.addEventListener('lostpointercapture', onUp, { passive: false });
    },

    updateJoystick: function (clientX, clientY) {
      if (!this.joystickRect) return;
      const centerX = this.joystickRect.left + this.joystickRect.width / 2;
      const centerY = this.joystickRect.top + this.joystickRect.height / 2;
      const radius = this.joystickRect.width * 0.34;
      let dx = clientX - centerX;
      let dy = clientY - centerY;
      const length = Math.sqrt(dx * dx + dy * dy) || 1;
      const limited = Math.min(length, radius);
      dx = (dx / length) * limited;
      dy = (dy / length) * limited;
      this.knob.style.transform = 'translate(' + dx.toFixed(1) + 'px, ' + dy.toFixed(1) + 'px)';
      const nx = dx / radius;
      const ny = dy / radius;
      const deadzone = 0.14;
      const magnitude = Math.sqrt(nx * nx + ny * ny);
      if (magnitude < deadzone) {
        this.touchVector.x = 0;
        this.touchVector.y = 0;
      } else {
        const scale = Math.min(1, (magnitude - deadzone) / (1 - deadzone));
        this.touchVector.x = (nx / magnitude) * scale;
        this.touchVector.y = (ny / magnitude) * scale;
      }
    },

    resetJoystick: function () {
      this.joystickPointer = null;
      this.touchActive = false;
      this.touchVector.x = 0;
      this.touchVector.y = 0;
      if (this.knob) this.knob.style.transform = 'translate(0px, 0px)';
    },

    setupDashButton: function () {
      this.dashButton = document.getElementById('btn-touch-dash');
      if (!this.dashButton) return;
      const self = this;
      this.dashButton.addEventListener('pointerdown', function (event) {
        event.preventDefault();
        event.stopPropagation();
        self.pressed.Enter = true;
        self.dashButton.classList.add('pressed');
        NO.GameAudio.unlock();
      }, { passive: false });
      const release = function () {
        self.dashButton.classList.remove('pressed');
      };
      this.dashButton.addEventListener('pointerup', release);
      this.dashButton.addEventListener('pointercancel', release);
      this.dashButton.addEventListener('pointerleave', release);
    },

    clearKeys: function () {
      this.keys = Object.create(null);
    },

    clearPressed: function () {
      this.pressed = Object.create(null);
    },

    isDown: function (code) {
      return Boolean(this.keys[code]);
    },

    consume: function (code) {
      if (this.pressed[code]) {
        this.pressed[code] = false;
        return true;
      }
      return false;
    },

    getMove: function () {
      let x = 0;
      let y = 0;
      if (this.keys.KeyA || this.keys.ArrowLeft) x -= 1;
      if (this.keys.KeyD || this.keys.ArrowRight) x += 1;
      if (this.keys.KeyW || this.keys.ArrowUp) y -= 1;
      if (this.keys.KeyS || this.keys.ArrowDown) y += 1;
      const keyboardLength = Math.sqrt(x * x + y * y);
      if (keyboardLength > 1) {
        x /= keyboardLength;
        y /= keyboardLength;
      }
      if (this.touchActive) {
        const tx = this.touchVector.x;
        const ty = this.touchVector.y;
        const touchLength = Math.sqrt(tx * tx + ty * ty);
        if (touchLength > 0.05) {
          return { x: tx, y: ty, length: Math.min(1, touchLength) };
        }
      }
      return { x, y, length: Math.min(1, keyboardLength) };
    },

    endFrame: function () {
      this.clearPressed();
    }
  };

  NO.Input = Input;
})();
