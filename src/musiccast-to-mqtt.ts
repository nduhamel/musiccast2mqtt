
import { StaticLogger } from './static-logger';
import mqtt, { MqttClient, IClientPublishOptions } from 'mqtt';
import { ConfigLoader } from './config'
import { MusiccastEventListener } from './musiccast-event-listener';
import { IDeviceUpdatedListener, MusiccastDeviceManager } from './musiccast-device-manager';
import { MusiccastCommands, MusiccastSystemCommands } from './musiccast-commands';
import { MusiccastCommandMapping } from './musiccast-command-mapping';


export class MusiccastToMqtt implements IDeviceUpdatedListener {

    private readonly log = StaticLogger.CreateLoggerForSource('Musiccast2mqtt');
    private readonly mqtt_uri: string;
    private readonly mqtt_username: string;
    private readonly mqtt_password: string;
    private readonly mqtt_prefix: string;
    private readonly mqtt_insecure: boolean;
    private readonly mqtt_retain: boolean;

    private readonly deviceManager: MusiccastDeviceManager;
    private mqttClient?: MqttClient;
    private mqttConnected: boolean;

    constructor() {
        let config = ConfigLoader.Config()
        this.mqtt_uri = config.brokerUrl;
        this.mqtt_username = config.brokerUsername;
        this.mqtt_password = config.brokerPassword;
        this.mqtt_prefix = config.prefix;
        this.mqtt_insecure = config.insecure;
        this.mqtt_retain = config.mqttRetain;
        this.mqttConnected = false;
        this.deviceManager = MusiccastDeviceManager.getInstance();
        this.deviceManager.subscribe(this);
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

    public onDeviceUpdated(zoneId: string, topic: string, payload: any, isDevice?: boolean): void {
        if (typeof isDevice !== 'undefined' && isDevice ) {
            this.publish(`device/status/${zoneId}/${topic}`, payload, { retain: this.mqtt_retain, qos: 0 });
        } else {
            this.publish(`status/${zoneId}/${topic}`, payload, { retain: this.mqtt_retain, qos: 0 });
        }
    }

    private connect(): void {
        this.log.info('mqtt trying to connect {mqtt_url}, with user: {mqtt_username}', this.mqtt_uri, this.mqtt_username);

        this.mqttClient = mqtt.connect(this.mqtt_uri, {
            username: this.mqtt_username,
            password: this.mqtt_password,
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
            this.log.debug('mqtt < {topic}: {payload}', topic, payload);

            try {
                const parts: string[] = topic.replace(`${this.mqtt_prefix}/`, '').split('/')

                payload = this.parsePayload(payload.toString());

                switch (parts[0]) {
                    case 'set':
                        switch (parts[1]) {
                            case 'discover':
                                if (payload === 1) {
                                    this.discover();
                                }
                                break;
                            // listen to [mqtt_prefix]/set/system/[device_name]/[command]
                            case 'system':
                                const device_name: string | undefined = parts[2]
                                const device = this.deviceManager.getDeviceByName(device_name);
                                const command: string | undefined = parts[3]
                                let mcCommand: MusiccastSystemCommands | undefined;
                                if (command !== undefined && Object.values(MusiccastSystemCommands).some(v => v === command.toLowerCase())) {
                                    mcCommand = command.toLowerCase() as MusiccastSystemCommands;
                                }
                                if (mcCommand) {
                                    MusiccastCommandMapping.ExecuteCommandSystem(device, mcCommand, payload);
                                }
                                break;
                            default:
                                let zone = this.deviceManager.getZoneById(parts[1]);
                                if (zone !== undefined) {
                                    let command = parts[2];
                                    let mcCommand: MusiccastCommands | undefined;
                                    if (command !== undefined && Object.values(MusiccastCommands).some(v => v === command.toLowerCase())) {
                                        mcCommand = command.toLowerCase() as MusiccastCommands;
                                    }
                                    if (mcCommand)
                                        MusiccastCommandMapping.ExecuteCommand(zone, mcCommand, payload);
                                    else {
                                        this.log.error('unknown topic "{topic}"', parts[2]);
                                    }
                                }
                                else {
                                    this.log.error('unknown topic "{topic}"', parts[1]);
                                }
                        };
                        break;
                    default:
                        this.log.error('unknown topic "{0}"', parts[0]);
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

    private parsePayload(payload: string | undefined): any | number | undefined | boolean {
        if (payload === undefined) return;
        if (payload === '') return '';
        if (payload === 'false') return false;
        if (payload === 'true') return true;
        if (isNaN(Number(payload)) === false) return Number(payload);
        try {
            return JSON.parse(payload)
        } catch {
        }
        return payload
    }
}
