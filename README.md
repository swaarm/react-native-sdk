# Swaarm SDK for React Native

The Swaarm SDK for React Native allows for better measurement and tracking of user journeys and
activities in apps that use the React Native framework.

## Installation

Add the SDK and its peer dependencies to your `package.json`:

```
"@swaarm/swaarm-sdk": "^1.4.0",
"@react-native-async-storage/async-storage": "^1.19.1",
"react-native-device-info": "^10.8.0",
```

If you are already using `@react-native-async-storage/async-storage` or `react-native-device-info`
in your project, keep your existing versions.

### Optional native identifiers

The SDK does not `require()` identifier packages itself — Metro resolves imports at bundle time,
so hiding a `require` inside a try/catch is not reliable. Instead, install the packages in your
host app and pass the modules through `init`'s `nativeModules` option. That way Metro sees the
imports and the SDK simply reads whatever you hand it.

**App Set ID (Android vendor id):**

```bash
npm install react-native-app-set-id
```

Without this package, the SDK falls back to `getUniqueId()` (SSAID) on Android. On iOS it always
uses `identifierForVendor`, which needs no extra package.

**IDFA / GAID (advertising id):**

```bash
npm install react-native-idfa-aaid
```

Without this package, `advertisingId` is reported as `null` in every event.

#### iOS: App Tracking Transparency

On iOS 14.5+ you must request App Tracking Transparency permission from the user before the OS
returns a real IDFA; otherwise it returns the zero UUID (`00000000-0000-0000-0000-000000000000`),
which the SDK detects and reports as `null`. Request ATT from your app (for example via
[`react-native-tracking-transparency`](https://github.com/mrousavy/react-native-tracking-transparency))
before calling `SwaarmClient.init(...)`, or re-initialize the SDK after the user grants permission.

Remember to add `NSUserTrackingUsageDescription` to your `Info.plist`.

#### Android: ad id permission

On Android 13+ apps that read GAID must declare:

```xml
<uses-permission android:name="com.google.android.gms.permission.AD_ID" />
```

in `AndroidManifest.xml`.

Install the dependencies:

```bash
npm install
```

### iOS

```bash
npx pod-install
```

### Android

Make sure the following permission is present in your `AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.INTERNET" />
```

Add the Google Play install referrer dependency to your app's `build.gradle`:

```
implementation 'com.android.installreferrer:installreferrer:2.2'

allprojects {
    repositories {
        maven { url "https://maven.google.com" }
    }
}
```

If you are using Proguard, also add:

```
-keep public class com.android.installreferrer.** { *; }
```

## Configuration

Import the client:

```javascript
import {SwaarmClient} from "@swaarm/swaarm-sdk";
```

Initialize the SDK as early as possible in your app (for example in your root component's
`useEffect`). Replace `example.swaarm.com` with your Swaarm tracking domain and `<token>` with your
app token.

```javascript
SwaarmClient.init("example.swaarm.com", "<token>");
```

Enable debug logging during development:

```javascript
SwaarmClient.init("example.swaarm.com", "<token>", {debug: true});
```

You can also toggle debug logs dynamically at any point:

```javascript
SwaarmClient.log(true);
```

### Initialization options

`SwaarmClient.init(domain, token, options)` accepts the following options:

- `flushFrequency` (`number`, default `2`): how often, in seconds, queued events are sent to
  Swaarm.
- `debug` (`boolean`, default `false`): enables verbose SDK logging.
- `attributionCallback` (`(data: AttributionData) => void`, default `null`): invoked once valid
  attribution data is received.
- `deferredDeepLinkCallback` (`(route: string) => void`, default `null`): invoked on the first
  app run with the deferred deep link route, if one was registered.
- `maxQueueSize` (`number`, default `500`): maximum number of events kept in the local queue.
  When full, the oldest event is dropped.
- `nativeModules` (`{ appSetId?, idfaAaid? }`, default `{}`): references to the optional
  `react-native-app-set-id` and `react-native-idfa-aaid` modules (see above).

Example with all the optional identifier modules wired in:

```javascript
import AppSetID from "react-native-app-set-id";
import ReactNativeIdfaAaid from "react-native-idfa-aaid";

SwaarmClient.init("example.swaarm.com", "<token>", {
    debug: true,
    nativeModules: {
        appSetId: AppSetID,
        idfaAaid: ReactNativeIdfaAaid,
    },
});
```

### Pre-init calls

`SwaarmClient.event(...)`, `SwaarmClient.purchase(...)` and `SwaarmClient.onAttribution(...)` are
safe to call before `init()` resolves. Events captured before init are buffered in memory with
their original timestamps and replayed into the queue as soon as init completes.

## Automatic event tracking

The SDK automatically tracks:

* **Install** — fires the first time the app is launched after installation, and includes the
  Google Play install referrer when available.
* **App open** (`__open`) — fires on every SDK initialization.

These events are enriched with device information: OS version, vendor id, and advertising id when
available.

## Custom events

### Recording a generic event

```javascript
SwaarmClient.event("registration", 25.0, JSON.stringify({email: "example@example.org"}));
```

Parameters:

* `typeId` — the Swaarm event type id (configured under **App → Events**).
* `aggregatedValue` — a numeric value Swaarm aggregates in reports (coins earned, items purchased,
  etc.).
* `customValue` — a free-form string displayed as-is in reports. JSON is recommended.

### Recording a purchase

```javascript
SwaarmClient.purchase(
    "subscription",
    11.0,
    "USD",
    "base64ReceiptOrPurchaseToken",
    "purchaseOrSubscriptionId"
);
```

Parameters:

* `typeId` — the Swaarm event type id for the purchase.
* `revenue` — amount of revenue generated.
* `currency` — ISO currency code (e.g. `"USD"`).
* `receiptOrToken` — optional. On iOS, the App Store receipt; on Android, the Play purchase token.
* `androidPurchaseId` — optional. The Play purchase or subscription id, used for validation.

## Deferred deep links

The Swaarm SDK can fetch a deferred deep link for the user on their first app launch. To use this,
pass a `deferredDeepLinkCallback` at init time:

```javascript
SwaarmClient.init("example.swaarm.com", "<token>", {
    deferredDeepLinkCallback: (route) => {
        navigation.navigate(route);
    },
});
```

The callback is invoked exactly once, on the first run, if the server has a deep link associated
with the device.

## Attribution data

The Swaarm SDK periodically contacts the server to retrieve attribution data using an exponential
backoff, until a decision is returned. You can either register a callback or read the latest
attribution data on demand:

```javascript
SwaarmClient.init("example.swaarm.com", "<token>", {
    attributionCallback: (data) => {
        if (data.decision === "PASSED") {
            console.log("Attributed to", data);
        }
    },
});

// Or, later:
console.log(SwaarmClient.attributionData);
```

Attribution data is persisted locally, so subsequent app launches can read it synchronously via
`SwaarmClient.attributionData` as soon as the SDK has finished initializing.

### `AttributionData` schema

```plaintext
+-----------------------------------------------------+
|   AttributionData                                   |
+-----------------------------------------------------+
| - offer: AttributionOffer?                          |
| - publisher: AttributionPublisher?                  |
| - ids: Ids?                                         |
| - decision: PostbackDecision?                       |
| - googleInstallReferrer: GoogleInstallReferrerData? |
+-----------------------------------------------------+
        |
        |------------------> +-------------------------+
                             |   AttributionOffer      |
                             +-------------------------+
                             | - id: String?           |
                             | - name: String?         |
                             | - lpId: String?         |
                             | - campaignId: String?   |
                             | - campaignName: String? |
                             | - adGroupId: String?    |
                             | - adGroupName: String?  |
                             | - adId: String?         |
                             | - adName: String?       |
                             +-------------------------+

        |------------------> +-----------------------+
                             |  AttributionPublisher |
                             +-----------------------+
                             | - id: String?         |
                             | - name: String?       |
                             | - subId: String?      |
                             | - subSubId: String?   |
                             | - site: String?       |
                             | - placement: String?  |
                             | - creative: String?   |
                             | - app: String?        |
                             | - appId: String?      |
                             | - unique1: String?    |
                             | - unique2: String?    |
                             | - unique3: String?    |
                             | - groupId: String?    |
                             +-----------------------+

        |------------------> +----------------------+
                             |       Ids            |
                             +----------------------+
                             | - installId: String? |
                             | - clickId: String?   |
                             | - userId: String?    |
                             +----------------------+

        |------------------> +-----------------------+
                             |   PostbackDecision    |
                             +-----------------------+
                             | - PASSED              |
                             | - FAILED              |
                             +-----------------------+

        |------------------> +----------------------------------+
                             | GoogleInstallReferrerData        |
                             +----------------------------------+
                             | - gclid: String?                 |
                             | - gbraid: String?                |
                             | - gadSource: String?             |
                             | - wbraid: String?                |
                             +----------------------------------+
```

## Reliability

### Event queue persistence

Queued events are persisted to `AsyncStorage` under `__SWAARM_EVENT_QUEUE` after every enqueue
and every successful flush. If the app is killed or crashes before a flush completes, the queue
is restored on the next launch and re-sent. The queue is capped at `maxQueueSize` (default 500);
when full, the oldest event is dropped to make room.

A batch is only dropped from the queue when the server returns a 2xx response. Network errors
and non-2xx responses leave the batch in place so the next flush cycle retries it.

### App lifecycle

The SDK subscribes to `AppState` and behaves as follows:

- On **background**: the flush and attribution timers are cleared and one final best-effort
  flush is fired.
- On **foreground**: the flush interval is restarted and attribution polling resumes.

### Clock-drift correction (always UTC)

The device clock can be skewed (user-set wrong time, timezone tricks, etc.). The SDK measures
the offset between the device and the server on every SDK response using the HTTP `Date`
header, compensates for round-trip latency, and persists the offset under
`__SWAARM_CLOCK_SKEW_MS`. Every event's `clientTime` is then rendered as UTC via
`new Date(capturedAt + skew).toISOString()` before being sent, so the server always receives
UTC timestamps. No server changes or additional endpoints are required.

## Stopping the SDK

Call `SwaarmClient.stop()` to stop the periodic event flush, the attribution polling, and the
AppState listener (for example when the user opts out of tracking).
