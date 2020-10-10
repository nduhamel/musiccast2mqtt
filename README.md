# musiccast2mqtt
This node application is a bridge between Yamaha Musiccast devices and a mqtt server. The status of all your Yamaha Musiccast devices will be published to mqtt and you can control the speakers over mqtt.

I build this bridge, because i wanted to improve linking  musiccast devices. Linking devices with this bridge will automatically do some actions like unpairing from old groups or delete groups if new client device a server.

## Special thanks
This bridge is inspired on [sonos2mqtt](https://github.com/svrooij/sonos2mqtt) by [Stephan van Rooij](https://github.com/svrooij). That was a great sample on how to create a smartspeaker to mqtt bridge. 
In addition [yamaha-yxc-nodejs](https://github.com/foxthefox/yamaha-yxc-nodejs) by [foxthefox](https://github.com/foxthefox) was a greate sample for communicating with musiccast devices from node.js.

