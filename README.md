# homebridge-mqtt-garagedoor-v2

A modern Homebridge v2-ready MQTT garage door opener plugin, rewritten from the legacy `homebridge-mqttgaragedoor-moppi` accessory plugin as a dynamic platform plugin.

## What changed

- Homebridge v2 platform plugin instead of legacy accessory plugin
- TypeScript source
- MQTT.js v5
- Node.js 20+ target
- Multiple doors in one platform config
- Homebridge UI schema support
- Uses modern `.onGet()` / `.onSet()` characteristic handlers

## Example config

```json
{
  "platform": "MQTTGarageDoorV2",
  "name": "MQTT Garage Door V2",
  "url": "mqtt://192.168.1.10:1883",
  "username": "mqtt-user",
  "password": "mqtt-password",
  "rejectUnauthorized": true,
  "doors": [
    {
      "name": "Garage Door",
      "statusSet": "garage/door/set",
      "commandPayload": "on",
      "openGet": "garage/door/open",
      "openValue": "true",
      "closedGet": "garage/door/closed",
      "closedValue": "true",
      "openStatusCmdTopic": "garage/door/open/get",
      "openStatusCmd": "",
      "closeStatusCmdTopic": "garage/door/closed/get",
      "closeStatusCmd": "",
      "doorRunInSeconds": 20,
      "pauseInSeconds": 0,
      "showlog": false
    }
  ]
}
```

## Install locally for testing

```bash
npm install
npm run build
npm link
```

Then in your Homebridge container or host:

```bash
npm link homebridge-mqtt-garagedoor-v2
```

Restart Homebridge after editing the config.

## Notes

- `statusSet` publishes `commandPayload` whenever HomeKit asks the door to open or close. This preserves the original plugin behavior where the relay topic received `on` for both directions.
- If no physical `openGet` / `closedGet` sensor topics are configured, the plugin assumes the door reached the requested state after `doorRunInSeconds`.
- If both sensors report the same value while the door is not moving, HomeKit reports obstruction/stopped.
