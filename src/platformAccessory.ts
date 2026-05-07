import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { MqttGarageDoorPlatform } from './platform.js';
import type { DoorConfig } from './types.js';

type DoorState = typeof import('homebridge').Characteristic.CurrentDoorState;

export class MqttGarageDoorAccessory {
  private readonly service: Service;
  private readonly doorState: DoorState;
  private reachable = true;
  private running = false;
  private open = false;
  private closed = true;
  private currentState: number;
  private targetState: number;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly platform: MqttGarageDoorPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly config: DoorConfig,
  ) {
    this.doorState = this.platform.Characteristic.CurrentDoorState;
    this.currentState = this.doorState.CLOSED;
    this.targetState = this.platform.Characteristic.TargetDoorState.CLOSED;
    this.reachable = !config.lwt;

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Open Source Community')
      .setCharacteristic(this.platform.Characteristic.Model, 'MQTT Garage Door V2')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.config.name)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, '2.0.0');

    this.service = this.accessory.getService(this.platform.Service.GarageDoorOpener)
      ?? this.accessory.addService(this.platform.Service.GarageDoorOpener, this.config.name);

    this.service.getCharacteristic(this.platform.Characteristic.CurrentDoorState)
      .onGet(() => this.getCurrentDoorState());

    this.service.getCharacteristic(this.platform.Characteristic.TargetDoorState)
      .onGet(() => this.getTargetDoorState())
      .onSet(value => this.setTargetDoorState(value));

    this.service.getCharacteristic(this.platform.Characteristic.ObstructionDetected)
      .onGet(() => this.getObstructionDetected());

    this.updateHomeKit();
  }

  refreshState(): void {
    if (this.config.openStatusCmdTopic) {
      this.platform.publish(this.config.openStatusCmdTopic, this.config.openStatusCmd ?? '');
    }
    if (this.config.closeStatusCmdTopic) {
      this.platform.publish(this.config.closeStatusCmdTopic, this.config.closeStatusCmd ?? '');
    }
  }

  handleMqttMessage(topic: string, payload: string): void {
    if (this.config.lwt && topic === this.config.lwt) {
      this.reachable = this.matches(payload, this.config.lwtPayload ?? 'offline') ? false : true;
      this.service.updateCharacteristic(
        this.platform.Characteristic.StatusFault,
        this.reachable
          ? this.platform.Characteristic.StatusFault.NO_FAULT
          : this.platform.Characteristic.StatusFault.GENERAL_FAULT,
      );
      return;
    }

    let changed = false;

    if (this.config.openGet && topic === this.config.openGet) {
      this.open = this.matches(payload, this.config.openValue ?? 'true');
      if (!this.config.closedGet) {
        this.closed = !this.open;
      }
      changed = true;
    }

    if (this.config.closedGet && topic === this.config.closedGet) {
      this.closed = this.matches(payload, this.config.closedValue ?? 'true');
      if (!this.config.openGet) {
        this.open = !this.closed;
      }
      changed = true;
    }

    if (!changed) {
      return;
    }

    this.reachable = true;
    this.clearTimer();
    this.running = false;
    this.recalculateStateFromSensors();
    this.updateHomeKit();

    if (this.config.pauseInSeconds && this.currentState === this.doorState.OPEN) {
      this.timer = setTimeout(() => {
        void this.setTargetDoorState(this.platform.Characteristic.TargetDoorState.CLOSED);
      }, this.config.pauseInSeconds * 1000);
    }
  }

  private getCurrentDoorState(): CharacteristicValue {
    this.refreshState();
    this.assertReachable();
    return this.currentState;
  }

  private getTargetDoorState(): CharacteristicValue {
    this.assertReachable();
    return this.targetState;
  }

  private async setTargetDoorState(value: CharacteristicValue): Promise<void> {
    this.assertReachable();

    const target = Number(value);
    if (target === this.targetState && !this.running) {
      return;
    }

    this.targetState = target;
    this.running = true;
    this.clearTimer();
    this.currentState = target === this.platform.Characteristic.TargetDoorState.OPEN
      ? this.doorState.OPENING
      : this.doorState.CLOSING;
    this.updateHomeKit();

    this.platform.log.info(`${this.config.name}: triggering garage door command`);
    this.platform.publish(this.config.statusSet, this.config.commandPayload ?? 'on');

    this.timer = setTimeout(() => this.finishAssumedRun(), (this.config.doorRunInSeconds ?? 20) * 1000);
  }

  private finishAssumedRun(): void {
    this.running = false;

    if (!this.config.openGet && !this.config.closedGet) {
      this.open = this.targetState === this.platform.Characteristic.TargetDoorState.OPEN;
      this.closed = !this.open;
    }

    this.recalculateStateFromSensors();
    this.updateHomeKit();

    if (this.config.pauseInSeconds && this.currentState === this.doorState.OPEN) {
      this.timer = setTimeout(() => {
        void this.setTargetDoorState(this.platform.Characteristic.TargetDoorState.CLOSED);
      }, this.config.pauseInSeconds * 1000);
    }
  }

  private recalculateStateFromSensors(): void {
    if (this.open && !this.closed) {
      this.currentState = this.doorState.OPEN;
      this.targetState = this.platform.Characteristic.TargetDoorState.OPEN;
      return;
    }

    if (this.closed && !this.open) {
      this.currentState = this.doorState.CLOSED;
      this.targetState = this.platform.Characteristic.TargetDoorState.CLOSED;
      return;
    }

    this.currentState = this.doorState.STOPPED;
  }

  private getObstructionDetected(): CharacteristicValue {
    return !this.running && this.open === this.closed;
  }

  private updateHomeKit(): void {
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentDoorState, this.currentState);
    this.service.updateCharacteristic(this.platform.Characteristic.TargetDoorState, this.targetState);
    this.service.updateCharacteristic(this.platform.Characteristic.ObstructionDetected, this.getObstructionDetected());
    this.debugState();
  }

  private matches(actual: string, expected: string | boolean | number): boolean {
    return actual === String(expected);
  }

  private assertReachable(): void {
    if (!this.reachable) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private debugState(): void {
    if (!this.config.showlog) {
      return;
    }
    this.platform.log.debug(`${this.config.name}: open=${this.open} closed=${this.closed} running=${this.running} current=${this.currentState} target=${this.targetState}`);
  }
}
