/** Representation of an attribution offer. */
export interface AttributionOffer {
    id?: string | null;
    name?: string | null;
    lpId?: string | null;
    campaignId?: string | null;
    campaignName?: string | null;
    adGroupId?: string | null;
    adGroupName?: string | null;
    adId?: string | null;
    adName?: string | null;
}

/** Representation of an attribution publisher. */
export interface AttributionPublisher {
    id?: string | null;
    name?: string | null;
    subId?: string | null;
    subSubId?: string | null;
    site?: string | null;
    placement?: string | null;
    creative?: string | null;
    app?: string | null;
    appId?: string | null;
    unique1?: string | null;
    unique2?: string | null;
    unique3?: string | null;
    groupId?: string | null;
}

/** Identifiers relevant to the attribution process. */
export interface Ids {
    installId?: string | null;
    clickId?: string | null;
    userId?: string | null;
}

/** Information provided by the Google Play Install Referrer API. */
export interface GoogleInstallReferrerData {
    gclid?: string | null;
    gbraid?: string | null;
    gadSource?: string | null;
    wbraid?: string | null;
}

/** Outcome of the postback process. */
export type PostbackDecision = "PASSED" | "FAILED";

/** Server-provided attribution data. */
export interface AttributionData {
    offer?: AttributionOffer | null;
    publisher?: AttributionPublisher | null;
    ids?: Ids | null;
    decision?: PostbackDecision | null;
    googleInstallReferrer?: GoogleInstallReferrerData | null;
}

export type AttributionCallback = (data: AttributionData) => void;
export type DeferredDeepLinkCallback = (route: string) => void;

/**
 * Shape of the optional native-module bag passed to `init()`. The host app is
 * responsible for importing the packages so Metro bundles them; the SDK only
 * reads the modules it's handed.
 */
export interface SwaarmNativeModules {
    /**
     * Optional reference to `react-native-app-set-id` (or any module that
     * exposes `getAppSetId()` / `getAppSetIdAsync()` / `getAsync()`). When
     * supplied, the SDK uses the App Set ID as the Android vendor id; without
     * it, the SDK falls back to `getUniqueId()` (SSAID).
     */
    appSetId?: unknown;
    /**
     * Optional reference to `react-native-idfa-aaid` (or any module that
     * exposes `getAdvertisingInfo()`). When supplied, the SDK reports the real
     * IDFA (iOS) / GAID (Android) as `advertisingId` in every event; without
     * it, `advertisingId` is `null`.
     */
    idfaAaid?: unknown;
}

export interface SwaarmInitOptions {
    /** How often, in seconds, queued events are flushed to Swaarm. Defaults to 2. */
    flushFrequency?: number;
    /** Enables verbose logging. Defaults to false. */
    debug?: boolean;
    /** Invoked once valid attribution data is received from the server. */
    attributionCallback?: AttributionCallback;
    /** Invoked on first app run with a deferred deep link, if any. */
    deferredDeepLinkCallback?: DeferredDeepLinkCallback;
    /**
     * Maximum number of events kept in the local queue. When the queue is
     * full, the oldest event is dropped. Defaults to 500.
     */
    maxQueueSize?: number;
    /** Optional native-module references for IDFA/GAID and App Set ID. */
    nativeModules?: SwaarmNativeModules;
}

export class SwaarmClient {
    /**
     * Initializes the Swaarm SDK.
     *
     *   SwaarmClient.init(domain, token, {
     *     flushFrequency, debug, attributionCallback, deferredDeepLinkCallback,
     *     maxQueueSize, nativeModules,
     *   })
     */
    static init(
        domain: string,
        token: string,
        options?: SwaarmInitOptions
    ): Promise<SwaarmClient>;

    /**
     * Records a custom event. Safe to call before `init()` resolves — pre-init
     * calls are buffered and replayed once init completes.
     */
    static event(typeId: string, aggregatedValue?: number, customValue?: string): void;

    /**
     * Records a purchase event. Safe to call before `init()` resolves.
     */
    static purchase(
        typeId: string,
        revenue?: number,
        currency?: string,
        receiptOrToken?: string,
        androidPurchaseId?: string
    ): void;

    /**
     * Registers a callback invoked when valid attribution is received. Safe
     * to call before `init()`. If attribution data is already available when
     * this is called, the callback is invoked synchronously.
     */
    static onAttribution(callback: AttributionCallback): void;

    /** The most recent server-provided attribution data, if any. */
    static readonly attributionData: AttributionData | null;

    /** Stops the periodic event flush, attribution polling, and AppState listener. */
    static stop(): void;

    /** Toggles debug logging at runtime. */
    static log(enabled: boolean): void;
}
