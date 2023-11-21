# Swaarm SDK for React Native

The Swaarm SDK for React Native allows for better measurement and tracking of user journeys and activities in
apps that use the React Native framework

## Installation

To install the SDK you need to add the following dependencies to your package.json file:

```
    "@swaarm/swaarm-sdk": "^1.0.6",
    "@react-native-async-storage/async-storage": "^1.19.6",
    "react-native-device-info": "^10.11.0",
```

If you are already using the react-native-async-storage or react-native-device-info libraries in your project, feel free
to skip them and use your existing versions.

To install the dependencies run: 

```bash
    npm install
```

### Installation for iOS

If you are targeting iOS as a platform make sure to also run:
```bash
    npx pod-install
```

### Installation for Android

If you are targeting Android as a platform, make sure to add the following permissions in your `AndroidManifest.xml` file:

```xml
    <uses-permission android:name="android.permission.INTERNET" />
```

In your app's build.gradle file you will need to add:

```
compile 'com.android.installreferrer:installreferrer:2.2'

...

allprojects {
    repositories {
        maven {
            url "https://maven.google.com"
        }
    }
}
```

#### Proguard settings

If you are using Proguard, add these lines to your Proguard file:

```
-keep public class com.android.installreferrer.** { *; }
```

## Configuration

In your App.js (or App.tsx), init the Swaarm SDK client using your tracking domain together with your app token as early as possible:

```javascript
    SwaarmClient.init("track.mycompany.swaarm-app.com", "abc123");
```

To enable Swaarm SDK logging you can pass a third parameter:

```javascript
    SwaarmClient.init("track.mycompany.swaarm-app.com", "abc123", true);
```

or call the log method at any point in the execution of the app:

```javascript
    SwaarmClient.log(true)
```

## Recording events

To record any event you can use the general `SwaarmClient.event` method which takes 3 parameters:

 * Event Type Id - the name of the event that you wanted to track as defined in Swaarm's Events under the "Advertiser Event Type Id" field. This can be "registration" or "first_time_deposit" etc.
 * Aggregated value - this is a numeric value that Swaarm will hold for you and can aggregate in the reports. Could be the amount of coins the user purchased, how many tasks they completed etc.
 * Custom value - this is a free field that can be used to store any additional information about the event. For a registration you might want to put the user's id or the email. For a payment you might want to store the package that the user selected. You can even send JSON and then analyse it using our SQL Lab.

Example:

```javascript
    SwaarmClient.event('earned_coins', 120, '{"plan": "premium"}');
```

To register a purchase event you can use the more specialized `SwaarmClient.purchase` call

```javascript
    SwaarmClient.purchase("registration", 12.42, "USD",  "iOS purchase or subscription receipt", "android purchase or subscription id")
```

By default, the method requires a monetary value and a currency. To enable the validation of 
purchases made using App/Play Store functionality you can pass the receipt or purchase id.

The SDK will automatically record app installations, open events or reinstalls, there is no need to
fire such events
