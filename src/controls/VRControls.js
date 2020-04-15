import { EventDispatcher, Vector3, Logger } from 'yuka';
import { WEAPON_TYPES_BLASTER, WEAPON_TYPES_SHOTGUN, WEAPON_TYPES_ASSAULT_RIFLE } from '../core/Constants.js';
import { CONFIG } from '../core/Config.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { fetchProfile, MotionController, Constants } from '@webxr-input-profiles/motion-controllers/dist/motion-controllers.module.js'
import * as THREE from 'three';

const PI05 = Math.PI / 2;
const direction = new Vector3();
const velocity = new Vector3();

const STEP1 = 'step1';
const STEP2 = 'step2';

let currentSign = 1;
let elapsed = 0;

const euler = { x: 0, y: 0, z: 0 };

/**
* Holds the implementation of the VR First-Person Controls.
*
*/
class VRControls extends EventDispatcher {

	/**
	* Constructs a new first person controls.
	*
	* @param {Player} owner - A refernce to the player object.
	*/
	constructor( world ) {

		super();

        this.world = world;
		this.owner = world.player;

		this.active = false;
        this.xrScene = null;
        this.controllers = [];
        this.controllerGrips = [];
        this.inputBuffer = [];
        this.frameId = 0;
        this.clock = new THREE.Clock();
        this.delta = this.clock.getDelta(),
        this.xrReferenceSpace = null;
		this.movementX = 0; // mouse left/right
		this.movementY = 0; // mouse up/down

		this.lookingSpeed = CONFIG.CONTROLS.LOOKING_SPEED;
		this.brakingPower = CONFIG.CONTROLS.BRAKING_POWER;
		this.headMovement = CONFIG.CONTROLS.HEAD_MOVEMENT;
		this.weaponMovement = CONFIG.CONTROLS.WEAPON_MOVEMENT;

		this.input = {
            select: false,
			forward: false,
			backward: false,
			right: false,
			left: false,
			mouseDown: false
		};

		this.sounds = new Map();

		this._mouseDownHandler = onMouseDown.bind( this );
		this._mouseUpHandler = onMouseUp.bind( this );
		this._mouseMoveHandler = onMouseMove.bind( this );
		this._keyDownHandler = onKeyDown.bind( this );
		this._keyUpHandler = onKeyUp.bind( this );
        
		this._onSessionStarted = onSessionStarted.bind( this );
		this._onSessionEnded = onSessionEnded.bind( this );
        this._onInputSourcesChange = onInputSourcesChange.bind(this);
        var geometry = new THREE.BufferGeometry();
        geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [ 0, 0, 0, 0, 0, -100 ], 3 ) );
        geometry.setAttribute( 'color', new THREE.Float32BufferAttribute( [ 0.5, 0.5, 0.5, 0, 0, 0 ], 3 ) );

        this.cameraHolder = null;
        var material = new THREE.LineBasicMaterial( { vertexColors: true, blending: THREE.AdditiveBlending } );
        this.line = new THREE.Line( geometry, material );
        this.line.name = 'laser';
        this.line.matrixAutoUpdate = false;
	}

	/**
	* Connects the event listeners and activates the controls.
	*
	* @return {VRControls} A reference to this instance.
	*/
	connect() {

        if (this.world.xrSupported) {
            this.world.renderer.xr.enabled = true;
            const sessionInit = { optionalFeatures: [ 'local-floor', 'bounded-floor' ] };
            navigator.xr.requestSession( 'immersive-vr', sessionInit ).then(
                (session) => {
                    this._onSessionStarted(session);
                }
            );
        }

        this.owner.head.setRenderComponent(this.line, sync);
        this.world.scene.add(this.line);
		return this;

	}

	/**
	* Disconnects the event listeners and deactivates the controls.
	*
	* @return {VRControls} A reference to this instance.
	*/
	disconnect() {

		return this;

	}

	/**
	* Ensures the controls reflect the current orientation of the owner. This method is
	* always used if the player's orientation is set manually. In this case, it's necessary
	* to adjust internal variables.
	*
	* @return {VRControls} A reference to this instance.
	*/
	sync() {

		this.owner.rotation.toEuler( euler );
		this.movementX = euler.y; // yaw

		this.owner.head.rotation.toEuler( euler );
		this.movementY = euler.x; // pitch

		return this;

	}

	/**
	* Resets the controls (e.g. after a respawn).
	*
	* @param {Number} delta - The time delta.
	* @return {VRControls} A reference to this instance.
	*/
	reset() {

		this.active = true;

		this.movementX = 0;
		this.movementY = 0;

		this.input.forward = false;
		this.input.backward = false;
		this.input.right = false;
		this.input.left = false;
		this.input.mouseDown = false;

		currentSign = 1;
		elapsed = 0;
		velocity.set( 0, 0, 0 );

	}

	/**
	* Update method of this controls. Computes the current velocity and head bobbing
	* of the owner (player).
	*
	* @param {Number} delta - The time delta.
	* @return {VRControls} A reference to this instance.
	*/
	update( delta ) {        
		if ( this.active ) {
            this.cameraHolder.position.copy(this.owner.position);
            this.world.xrCamera = this.world.renderer.xr.getCamera(this.world.camera);

            //https://stackoverflow.com/questions/43606135/split-quaternion-into-axis-rotations
            var q = new THREE.Quaternion();
            q.copy(this.world.xrCamera.quaternion);
            var theta = Math.atan2(q.y, q.w);
            this.owner.rotation.set(0, Math.sin(theta), 0, Math.cos(theta));
            
			this._updateVelocity( delta );

			const speed = this.owner.getSpeed();
			elapsed += delta * speed;

            var xrCameraLocalPosition = new THREE.Vector3();
            xrCameraLocalPosition.setFromMatrixPosition(this.world.xrCamera.matrix);
            if (this.controllers.length > 0) {
                var controller = this.controllers[0];
                this.owner.head.position.y = xrCameraLocalPosition.y*0.618;
                var q = new THREE.Quaternion();
                q.copy( this.owner.rotation ).inverse();
                this.owner.head.rotation.copy( q.multiply(controller.quaternion) );
                var u = new THREE.Euler();
                this.owner.head.rotation.toEuler(u);
                if (u.x > 1.0) {
                    this.input.forward = true;
                    this.input.backward = false;
                }
                if (u.x < -1.0) {
                    this.input.backward = true;
                    this.input.forward = false;
                }
                if (u.x >= -1.0 && controller.rotation.x <= 1.0) {
                    this.input.backward = false;
                    this.input.forward = false;
                }
                if (u.z > 1.0) {
                    if ( this.owner.hasWeapon( WEAPON_TYPES_SHOTGUN ) ) {

                        this.owner.changeWeapon( WEAPON_TYPES_SHOTGUN );

                    } 
                    else {
                        this.owner.changeWeapon( WEAPON_TYPES_BLASTER );

                    }
                }
                if (u.z < -1.0) {
                    if ( this.owner.hasWeapon( WEAPON_TYPES_ASSAULT_RIFLE ) ) {

                        this.owner.changeWeapon( WEAPON_TYPES_ASSAULT_RIFLE );

                    }
                    else {
                        this.owner.changeWeapon( WEAPON_TYPES_BLASTER );

                    }
                }
            }
			// elapsed is used by the following two methods. it is scaled with the speed
			// to modulate the head bobbing and weapon movement

			this._updateHead();
			this._updateWeapon();

            //60 frames/second input sampling
            if (this.clock.getDelta() < 1/60) {
                return this;
            }
            this.clock.start();
            this.frameId ++;
            this.inputBuffer[this.frameId] = {
                delta: delta,
                vrController: {
                    select: this.input.select,
                    trigger: {},
                    touchpad: {}
                }
            };

            if (this.inputBuffer[this.frameId].vrController.select) {
                // if the trigger is pressed and an automatic weapon like the assault rifle is equiped
                // support automatic fire
                if ( this.owner.isAutomaticWeaponUsed() ) {
                    this.owner.shoot();
                }
                else if (!this.inputBuffer[this.frameId - 1].vrController.select) {
                    this.owner.shoot();
                }
            }
		}

		return this;

	}

	/**
	* Computes the current velocity of the owner (player).
	*
	* @param {Number} delta - The time delta.
	* @return {VRControls} A reference to this instance.
	*/
	_updateVelocity( delta ) {

		const input = this.input;
		const owner = this.owner;

		velocity.x -= velocity.x * this.brakingPower * delta;
		velocity.z -= velocity.z * this.brakingPower * delta;

		direction.z = Number( input.forward ) - Number( input.backward );
		direction.x = Number( input.left ) - Number( input.right );
		direction.normalize();

		if ( input.forward || input.backward ) velocity.z -= direction.z * CONFIG.CONTROLS.ACCELERATION * delta;
		if ( input.left || input.right ) velocity.x -= direction.x * CONFIG.CONTROLS.ACCELERATION * delta;

		owner.velocity.copy( velocity ).applyRotation( owner.rotation );

		return this;

	}

	/**
	* Computes the head bobbing of the owner (player).
	*
	* @return {VRControls} A reference to this instance.
	*/
	_updateHead() {

		const owner = this.owner;
		const head = owner.head;

		// some simple head bobbing

		//const motion = Math.sin( elapsed * this.headMovement );

		//head.position.y = Math.abs( motion ) * 0.06;
		//head.position.x = motion * 0.08;

		//

		//head.position.y = owner.height;

		//

		const sign = Math.sign( Math.cos( elapsed * this.headMovement ) );

		if ( sign < currentSign ) {

			currentSign = sign;

			const audio = this.owner.audios.get( STEP1 );
			audio.play();

		}

		if ( sign > currentSign ) {

			currentSign = sign;

			const audio = this.owner.audios.get( STEP2 );
			audio.play();

		}

		return this;

	}

	/**
	* Computes the movement of the current armed weapon.
	*
	* @return {VRControls} A reference to this instance.
	*/
	_updateWeapon() {

		const owner = this.owner;
		const weaponContainer = owner.weaponContainer;

		const motion = Math.sin( elapsed * this.weaponMovement );

		weaponContainer.position.x = motion * 0.005;
		weaponContainer.position.y = Math.abs( motion ) * 0.002;

		return this;

	}

}

// event listeners

function onMouseDown( event ) {

	if ( this.active && event.which === 1 ) {

		this.input.mouseDown = true;
		this.owner.shoot();

	}

}

function onMouseUp( event ) {

	if ( this.active && event.which === 1 ) {

		this.input.mouseDown = false;

	}

}

function onMouseMove( event ) {

	if ( this.active ) {

		this.movementX -= event.movementX * 0.001 * this.lookingSpeed;
		this.movementY -= event.movementY * 0.001 * this.lookingSpeed;

		this.movementY = Math.max( - PI05, Math.min( PI05, this.movementY ) );

		this.owner.rotation.fromEuler( 0, this.movementX, 0 ); // yaw
		this.owner.head.rotation.fromEuler( this.movementY, 0, 0 ); // pitch

	}

}

function onKeyDown( event ) {

	if ( this.active ) {

		switch ( event.keyCode ) {

			case 38: // up
			case 87: // w
				this.input.forward = true;
				break;

			case 37: // left
			case 65: // a
				this.input.left = true;
				break;

			case 40: // down
			case 83: // s
				this.input.backward = true;
				break;

			case 39: // right
			case 68: // d
				this.input.right = true;
				break;

			case 82: // r
				this.owner.reload();
				break;

			case 49: // 1
				this.owner.changeWeapon( WEAPON_TYPES_BLASTER );
				break;

			case 50: // 2
				if ( this.owner.hasWeapon( WEAPON_TYPES_SHOTGUN ) ) {

					this.owner.changeWeapon( WEAPON_TYPES_SHOTGUN );

				}
				break;

			case 51: // 3
				if ( this.owner.hasWeapon( WEAPON_TYPES_ASSAULT_RIFLE ) ) {

					this.owner.changeWeapon( WEAPON_TYPES_ASSAULT_RIFLE );

				}
				break;

		}

	}

}

function onKeyUp( event ) {

	if ( this.active ) {

		switch ( event.keyCode ) {

			case 38: // up
			case 87: // w
				this.input.forward = false;
				break;

			case 37: // left
			case 65: // a
				this.input.left = false;
				break;

			case 40: // down
			case 83: // s
				this.input.backward = false;
				break;

			case 39: // right
			case 68: // d
				this.input.right = false;
				break;

		}

	}

}

function onSessionStarted( session ) {
    session.addEventListener( 'end', this._onSessionEnded );
    session.addEventListener('inputsourceschange', this._onInputSourcesChange);
    session.requestReferenceSpace('local').then((referenceSpace) => {
        this.xrReferenceSpace = referenceSpace;
    });

    this.world.renderer.xr.setSession( session );
    this.world.xrSession = session;
    this.world.xrSession.updateRenderState({
        depthFar: 500,
        //depthNear: 0.3
    });

    this.xrScene = new THREE.Scene();
    const hemiLight = new THREE.HemisphereLight( 0xffffff, 0x444444, 1 );
	hemiLight.position.set( 0, 0, 0 );
    this.world.xrScene.add( hemiLight );
    //console.log(this);
    this.active = true;
    this.owner.activate();
    this.world.camera.position.set( 0, 0, 0 );
    this.cameraHolder = new THREE.Object3D();
    this.cameraHolder.add(this.world.camera);
    this.world.scene.add(this.cameraHolder);
}

function onSessionEnded( /*event*/ ) {
    this.owner.deactivate();
    this.world.xrSession.removeEventListener( 'end', this._onSessionEnded );
    this.world.xrSession = null;
	this.owner.deactivate();
    this.world.scene.position.set(0, 0, 0);
    //console.log(this.inputBuffer);
}

function onInputSourcesChange(event) {
    var i  = 0;
    this.controllers = [];
    event.added.forEach((xrInputSource) => {
        //createMotionController(xrInputSource, this.controllers);
        this.controllers[i] = this.world.renderer.xr.getController( i );
        var controllerModelFactory = new XRControllerModelFactory();
        this.controllers[i].addEventListener( 'connected', function ( event ) {
            this.add( buildController( event.data ) );
        } );
        this.controllers[i].addEventListener( 'selectstart', ( event ) => {
            this.input.select = true;
        } );
        this.controllers[i].addEventListener( 'selectend',  ( event ) => {
            this.input.select = false;
        } );
        this.controllers[i].add( controllerModelFactory.createControllerModel( this.controllers[i] ) );
        this.controllers[i].xrInputSource = xrInputSource;
        this.world.xrScene.add( this.controllers[i] );
        i++;
    });
};
 
async function createMotionController(xrInputSource, controllers) {
    const uri = '../node_modules/@webxr-input-profiles/assets/dist/profiles';
    const motionControllers = {};
    const { profile, assetPath } = await fetchProfile(xrInputSource, uri);
    const motionController = new MotionController(xrInputSource, profile, assetPath);
    //motionControllers[xrInputSource] = motionController;
    //console.log(owner, motionControllers);
    //addMotionControllerToScene(motionController);
}

function initControllers() {
    //for (let inputSource of this.world.session.inputSources) {
        //this.controller1 = inputSource;
    //} 
    for ( let i = 0; i < this.world.xrSession.inputSources.length; i ++ ) {
        this.controllers[i] =  this.world.renderer.xr.getController(i); 

        this.controllers[i].addEventListener( 'selectstart', ( event ) => {
            onSelectStart(event);
        } );
        this.controllers[i].addEventListener( 'selectend',  ( event ) => {
            onSelectEnd(event);
        } );

        this.controllers[i].addEventListener( 'connected', function ( event ) {
            this.add( buildController( event.data ) );
        } );
        
    }
    if (this.active == true) this.owner.activate();
}

function buildController( data ) {

    switch ( data.targetRayMode ) {

        case 'tracked-pointer':

            var geometry = new THREE.BufferGeometry();
            geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [ 0, 0, 0, 0, 0, - 1 ], 3 ) );
            geometry.setAttribute( 'color', new THREE.Float32BufferAttribute( [ 0.5, 0.5, 0.5, 0, 0, 0 ], 3 ) );

            var material = new THREE.LineBasicMaterial( { vertexColors: true, blending: THREE.AdditiveBlending } );
            var line = new THREE.Line( geometry, material );
            line.name = 'laser';
            return line; 

        case 'gaze':

            var geometry = new THREE.RingBufferGeometry( 0.02, 0.04, 32 ).translate( 0, 0, - 1 );
            var material = new THREE.MeshBasicMaterial( { opacity: 0.5, transparent: true } );
            return new THREE.Mesh( geometry, material );

    }

}
function sync( entity, renderComponent ) {

	renderComponent.matrix.copy( entity.worldMatrix );

}

function syncCamera( entity, camera ) {

	camera.matrixWorld.copy( entity.getWorldPosition() );

}

export { VRControls };
