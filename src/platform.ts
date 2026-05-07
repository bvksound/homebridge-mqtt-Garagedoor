import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig as HbPlatformConfig } from 'homebridge';
import mqtt, { MqttClient } from 'mqtt';

import { PLUGIN_NAME, PLATFORM_NAME } from './settings.js';
import { MqttGarageDoorAccessory } from './platformAccessory.js';
import type { DoorConfig, PlatformConfig } from './types.js';

export class MqttGarageDoorPlatform implements DynamicPlatformPlugin {
  public readonly accessories: PlatformAccessory[] = [];
  public readonly Service = this.api.hap.Service;
  public readonly Characteristic = this.api.hap.Characteristic;
  public readonly client: MqttClient;

  private readonly cfg: PlatformConfig;
  private readonly doorHandlers = new Map<string, MqttGarageDoorAccessory>();

  constructor(
    public readonly log: Logging,
    config: HbPlatformConfig,
    public readonly api: API,
  ) {
    this.cfg = config as unknown as PlatformConfig;

    if (!this.cfg?.url) {
      throw new Error('MQTT Garage Door V2 requires a broker url.');
    }

    this.client = mqtt.connect(this.cfg.url, {
      username: this.cfg.username,
      password: this.cfg.password,
      reconnectPeriod: 2000,
      connectTimeout: 30_000,
      keepalive: 10,
      clean: true,
      rejectUnauthorized: this.cfg.rejectUnauthorized ?? true,
      clientId: `homebridge-mqtt-garagedoor-v2-${Math.random().toString(16).slice(2, 10)}`,
    });

    this.client.on('connect', () => {
      this.log.info('Connected to MQTT broker');
      this.subscribeAll();
      for (const door of this.doorHandlers.values()) {
        door.refreshState();
      }
    });

    this.client.on('reconnect', () => this.log.debug('Reconnecting to MQTT broker'));
    this.client.on('error', error => this.log.error('MQTT error:', error.message));
    this.client.on('message', (topic, payload) => {
      const message = payload.toString();
      for (const door of this.doorHandlers.values()) {
        door.handleMqttMessage(topic, message);
      }
    });

    this.api.on('didFinishLaunching', () => this.discoverDevices());
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.push(accessory);
  }

  private discoverDevices(): void {
    const doors = this.cfg.doors ?? [];
    const activeUuids = new Set<string>();

    for (const doorConfig of doors) {
      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${doorConfig.name}`);
      activeUuids.add(uuid);
      const existing = this.accessories.find(accessory => accessory.UUID === uuid);

      if (existing) {
        existing.context.device = doorConfig;
        this.api.updatePlatformAccessories([existing]);
        this.doorHandlers.set(uuid, new MqttGarageDoorAccessory(this, existing, doorConfig));
      } else {
        const accessory = new this.api.platformAccessory(doorConfig.name, uuid);
        accessory.context.device = doorConfig;
        this.doorHandlers.set(uuid, new MqttGarageDoorAccessory(this, accessory, doorConfig));
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }

    const stale = this.accessories.filter(accessory => !activeUuids.has(accessory.UUID));
    if (stale.length) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
    }

    this.subscribeAll();
  }

  private subscribeAll(): void {
    if (!this.client.connected) {
      return;
    }

    const topics = new Set<string>();
    for (const door of this.cfg.doors ?? []) {
      this.addTopic(topics, door.openGet);
      this.addTopic(topics, door.closedGet);
      this.addTopic(topics, door.lwt);
    }

    for (const topic of topics) {
      this.client.subscribe(topic, error => {
        if (error) {
          this.log.error(`Failed to subscribe to ${topic}:`, error.message);
        } else {
          this.log.debug(`Subscribed to ${topic}`);
        }
      });
    }
  }

  private addTopic(topics: Set<string>, topic?: string): void {
    if (topic && topic.trim()) {
      topics.add(topic);
    }
  }

  publish(topic: string, payload: string): void {
    this.client.publish(topic, payload, error => {
      if (error) {
        this.log.error(`Failed to publish to ${topic}:`, error.message);
      }
    });
  }
}
