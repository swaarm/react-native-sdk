# Swaarm SDK for react-native

## Installation

update your package.json with the following `dependencies`:

```
    "@swaarm/swaarm-sdk": "^1.0.4",
    "@react-native-async-storage/async-storage": "^1.19.1",
    "react-native-device-info": "^10.8.0",
    "react-native-get-random-values": "^1.9.0"


```

then run 
```
    npm install --save
    npx pod-install

```

In your App.tsx, init the swaarm client singleton with the factory method `await SwaarmClient.init("<domain>", "<token>");` inside your main method. alternatively use a promise.


```
  Promise.resolve(SwaarmClient.init("<domain>", "<token>")).then(() => {
    SwaarmClient.event("lala", 4.9, "blub");
    SwaarmClient.purchase("purchase_it", 5.9, "USD", "transaction ID, receipt or token", "android purchase or subscription id");

  });

```


The SDK determines if an app was installed before by checking and setting a keychain flag on first start. if it's indeed a reinstall, the `__reinstall` event is sent in lieu of the initial one.

sent events will automatically be enriched with some userdata, e.g. os_version, vendorId and - if available - idfa.
On devices using ios14 and up, tracking needs to be specifically requested to be able to get a non-zero idfa. To enable the idfa,
tracking needs to be requested from a visible app, as per https://stackoverflow.com/a/72287836/1768607


event and purchase methods can be called as follows:

```
    SwaarmClient.event("type_id", 4.9, "custom_value");
    SwaarmClient.purchase("type_id", 5.9, "USD", "transaction ID, receipt or token", "android purchase or subscription id");
```
