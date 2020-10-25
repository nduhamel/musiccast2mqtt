
import { StaticLogger } from './static-logger';
import mqtt, { MqttClient, IClientPublishOptions } from 'mqtt';
import { ConfigLoader } from './config'
import { setTimeout, clearTimeout } from 'timers';
import { MusiccastDevice } from './musiccast-device';
import { MusiccastEventListener } from './musiccast-event-listener';
import { IDeviceUpdatedListener, MusiccastDeviceManager } from './musiccast-device-manager';


export class MusiccastToMqtt implements IDeviceUpdatedListener {
    private readonly log = StaticLogger.CreateLoggerForSource('Musiccast2mqtt.main');
    private readonly mqtt_uri: string;
    private readonly mqtt_prefix: string;
    private readonly mqtt_insecure: boolean;
    private readonly mqtt_retain: boolean;

    private readonly deviceManager: MusiccastDeviceManager;
    private mqttClient?: MqttClient;
    private mqttConnected: boolean;

    constructor() {
        let config = ConfigLoader.Config()
        this.mqtt_uri = config.mqtt;
        this.mqtt_prefix = config.prefix;
        this.mqtt_insecure = config.insecure;
        this.mqtt_retain = config.mqttRetain;
        this.mqttConnected = false;
        this.deviceManager = MusiccastDeviceManager.getInstance();
        this.deviceManager.subscribe(this);
        for (const device of config.devices) {
            this.deviceManager.createDeviceFromIp(device)
        }
    }

    public async start(): Promise<boolean> {
        let success: boolean = true
        this.connect();
        return success;
    }

    public stop(): void {
        MusiccastEventListener.DefaultInstance.StopListener();
        this.deviceManager.dispose();
        this.mqttClient?.end()
    }

    private connect(): void {
        this.log.info('mqtt trying to connect {mqtt_url}', this.mqtt_uri);

        this.mqttClient = mqtt.connect(this.mqtt_uri, {
            clientId: this.mqtt_prefix + '_' + Math.random().toString(16).substr(2, 8),
            will: { topic: this.mqtt_prefix + '/connected', payload: '0', qos: 0, retain: this.mqtt_retain },
            rejectUnauthorized: !this.mqtt_insecure
        });

        this.mqttClient.on('connect', () => {
            this.mqttConnected = true;
            this.log.info('mqtt connected {uri}', this.mqtt_uri);
            this.mqttClient.publish(this.mqtt_prefix + '/connected', '1', { qos: 0, retain: this.mqtt_retain })
            this.log.info('mqtt subscribe {topic1}', this.mqtt_prefix + '/set/#');
            this.mqttClient.subscribe([this.mqtt_prefix + '/set/#']);
        });

        this.mqttClient.on('close', () => {
            if (this.mqttConnected) {
                this.mqttConnected = false;
                this.log.info('mqtt closed ' + this.mqtt_uri);
            }
        });

        this.mqttClient.on('error', err => {
            this.log.error('mqtt', err.toString());
        });

        this.mqttClient.on('offline', () => {
            this.log.error('mqtt offline');
        });

        this.mqttClient.on('reconnect', () => {
            this.log.debug('mqtt reconnect');
        });

        this.mqttClient.on('message', (topic, payload: any) => {
            this.log.debug('mqtt <', topic, payload);
            try {
                payload = payload.toString();
                if (payload.indexOf('{') !== -1 || payload.indexOf('[') !== -1) {
                    try {
                        payload = JSON.parse(payload);
                    } catch (err) {
                        this.log.error(err.toString());
                    }
                } else if (payload === 'false') {
                    payload = false;
                } else if (payload === 'true') {
                    payload = true;
                } else if (!isNaN(payload)) {
                    payload = parseFloat(payload);
                }


                const topics: string[] = topic.split('/');

                switch (topics[1]) {
                    case 'set':
                        switch (topics[2]) {
                            case 'discover':
                                if (payload === 1) {
                                    this.discover();
                                }
                                break;
                            default:
                                let device: MusiccastDevice = this.deviceManager.getDeviceById(topics[2]);
                                if (device !== undefined) {
                                    device.setMqtt(topic, payload);
                                }
                                else {
                                    this.log.error('unknown {2}', topics[2]);
                                }
                        };
                        break;
                    default:
                        this.log.error('unknown {1}', topics[1]);
                }
            } catch (error) {
                this.log.error("Error while receiving mqtt message: {error}", error)
            }
        });
    }
    private async discover(): Promise<void> {
        this.publish('discover', { lastDiscover: new Date().toISOString(), discovering: true }, { retain: this.mqtt_retain, qos: 0 });
        let devices: string[] = await this.deviceManager.discover();
        this.publish('discover', { lastDiscover: new Date().toISOString(), discovering: false, discoveredDevices: devices }, { retain: this.mqtt_retain, qos: 0 });
    }

    private publish(topic: string, payload: string | any, options: IClientPublishOptions = {} as IClientPublishOptions): void {
        topic = `${this.mqtt_prefix}/${topic}`
        if (typeof payload === 'number')
            payload = payload.toString();
        if (typeof payload === 'boolean')
            payload = payload === true ? 'true' : 'false'
        this.log.verbose('Mqtt publish to {topic} {payload}', topic, payload)
        if (typeof payload !== 'string')
            payload = JSON.stringify(payload);
        this.mqttClient?.publish(topic, payload, options)
    }

    public onDeviceUpdated(deviceId: string, topic: string, payload: any): void {
        this.publish(`${deviceId}/${topic}`, payload, { retain: this.mqtt_retain, qos: 0 });
    }
}