// Input: the keyboard set, the mouse look, and the pointer lock. Firing is
// a held state, not an event, so automatic weapons keep firing while held.
export function createInput(canvas, onLockChange) {
  const state = {
    keys: new Set(),
    firing: false,
    jumpQueued: false,
    lookX: 0,
    lookY: 0,
    locked: false,
  };

  function onKeyDown(event) {
    if (event.repeat) return;
    state.keys.add(event.code);
    if (event.code === 'Space') {
      state.jumpQueued = true;
      event.preventDefault();
    }
  }
  function onKeyUp(event) {
    state.keys.delete(event.code);
  }
  function onMouseDown(event) {
    if (!state.locked) return;
    if (event.button === 0) state.firing = true;
  }
  function onMouseUp(event) {
    if (event.button === 0) state.firing = false;
  }
  function onMouseMove(event) {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  }
  function onLock() {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) state.firing = false;
    onLockChange(state.locked);
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', onLock);

  return {
    state,
    requestLock() {
      canvas.requestPointerLock();
    },
    releaseLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    takeLook() {
      const look = { x: state.lookX, y: state.lookY };
      state.lookX = 0;
      state.lookY = 0;
      return look;
    },
    takeJump() {
      const jump = state.jumpQueued;
      state.jumpQueued = false;
      return jump;
    },
  };
}
