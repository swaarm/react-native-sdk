import {gzip} from "pako"
import uuid from "react-native-uuid"
import {Platform, AppState} from "react-native"
import {
    getSystemVersion,
    getSystemName,
    getInstallReferrer,
    getManufacturer,
    getModel,
    getUniqueId,
} from "react-native-device-info"
import AsyncStorage from "@react-native-async-storage/async-storage"

const STORAGE_KEYS = {
    vendorId: "__SWAARM_USER_ID",
    firstRun: "__SWAARM_FIRST_RUN",
    attributionData: "__SWAARM_ATTRIBUTION_DATA",
    eventQueue: "__SWAARM_EVENT_QUEUE",
    clockSkew: "__SWAARM_CLOCK_SKEW_MS",
    appleAdsChecked: "__SWAARM_APPLE_ADS_CHECKED",
}

const DEFAULTS = {
    flushFrequency: 2,
    batchSize: 50,
    maxQueueSize: 500,
    attributionFetchInterval: 2,
    attributionMaxBackoffMs: 60 * 60 * 1000,
    attributionBackoffExponent: 1.5,
    clockSkewPersistThresholdMs: 500,
    appleAdsEndpoint: "https://api-adservices.apple.com/api/v1/",
    appleAdsMaxRetries: 3,
    appleAdsRetryDelayMs: 5000,
}

// Calls made before `init()` completes land here and are replayed into the
// event queue once the SDK is initialised. This lets the host app fire
// events during app boot without losing them.
const PRE_INIT = {
    pendingEvents: [],
    attributionCallback: null,
    deferredDeepLinkCallback: null,
}

class SwaarmClient {
    static _instance = null
    static _debug = false

    constructor() {
        this._events = []
        this._active = false
        this._initialized = false
        this._domain = ""
        this._userAgent = ""
        this._systemName = ""
        this._osv = ""
        this._vendorId = null
        this._advertisingId = null
        this._headers = {}
        this._flushFrequency = DEFAULTS.flushFrequency
        this._maxQueueSize = DEFAULTS.maxQueueSize
        this._flushInterval = null
        this._attributionData = null
        this._attributionTimer = null
        this._attributionCallback = null
        this._deferredDeepLinkCallback = null
        this._nativeModules = {}
        this._appStateSubscription = null
        this._appStateCurrent = "active"
        this._clockSkewMs = 0
        this._queuePersistPending = false
    }

    // =========================================================================
    // Public API
    // =========================================================================

    /**
     * Initializes the Swaarm SDK.
     *
     *   SwaarmClient.init(domain, token, {
     *     flushFrequency, debug, attributionCallback, deferredDeepLinkCallback,
     *     maxQueueSize,
     *     nativeModules: { appSetId, idfaAaid },
     *   })
     *
     * @returns {Promise<SwaarmClient>}
     */
    static async init(domain, token, options = {}) {
        return SwaarmClient._doInit(domain, token, options)
    }

    /**
     * Records a custom event. Safe to call before `init()` resolves — calls
     * made at that point are buffered and replayed once init completes.
     */
    static event(typeId, aggregatedValue = 0.0, customValue = "") {
        const client = SwaarmClient._instance
        if (!client || !client._initialized) {
            PRE_INIT.pendingEvents.push({
                kind: "event",
                capturedAtMs: Date.now(),
                args: [typeId, aggregatedValue, customValue],
            })
            return
        }
        if (SwaarmClient._debug) {
            console.log(`SwaarmSDK >> Firing event "${typeId}" aggregatedValue=${aggregatedValue} customValue=${customValue}`)
        }
        client._enqueueEvent({typeId, aggregatedValue, customValue})
    }

    /**
     * Records a purchase event. Safe to call before `init()` resolves.
     */
    static purchase(typeId, revenue = 0.0, currency, receiptOrToken, androidPurchaseId) {
        const client = SwaarmClient._instance
        if (!client || !client._initialized) {
            PRE_INIT.pendingEvents.push({
                kind: "purchase",
                capturedAtMs: Date.now(),
                args: [typeId, revenue, currency, receiptOrToken, androidPurchaseId],
            })
            return
        }
        if (SwaarmClient._debug) {
            console.log(`SwaarmSDK >> Firing purchase "${typeId}" revenue=${revenue} currency=${currency}`)
        }
        client._enqueueEvent({typeId, revenue, currency, receiptOrToken, androidPurchaseId})
    }

    /**
     * Registers a callback to be invoked when a valid attribution is received.
     * Safe to call before `init()` — the callback will be attached once init
     * completes. If attribution data is already available when this is called,
     * the callback is invoked synchronously.
     */
    static onAttribution(callback) {
        const client = SwaarmClient._instance
        if (!client) {
            PRE_INIT.attributionCallback = callback
            return
        }
        client._attributionCallback = callback
        if (client._attributionData && client._attributionData.decision) {
            try {
                callback(client._attributionData)
            } catch (e) {
                SwaarmClient._warn("Error in attribution callback", e)
            }
        }
    }

    /** Server-provided attribution data, or null if none is available yet. */
    static get attributionData() {
        return SwaarmClient._instance ? SwaarmClient._instance._attributionData : null
    }

    /** Stops the flush and attribution timers and detaches the AppState listener. */
    static stop() {
        const client = SwaarmClient._instance
        if (!client) return
        client._active = false
        client._stopIntervals()
        if (client._appStateSubscription) {
            try { client._appStateSubscription.remove() } catch (_) {}
            client._appStateSubscription = null
        }
    }

    /** Toggles debug logging at runtime. */
    static log(enabled) {
        SwaarmClient._debug = enabled === true
    }

    // =========================================================================
    // Init internals
    // =========================================================================

    static async _doInit(domain, token, options) {
        if (!domain || !token) {
            throw new Error("Domain and token must not be empty.")
        }

        if (!SwaarmClient._instance) {
            SwaarmClient._instance = new SwaarmClient()
        }
        const client = SwaarmClient._instance

        const {
            flushFrequency = DEFAULTS.flushFrequency,
            debug = false,
            attributionCallback = null,
            deferredDeepLinkCallback = null,
            nativeModules = {},
            maxQueueSize = DEFAULTS.maxQueueSize,
        } = options || {}

        SwaarmClient._debug = debug === true
        client._flushFrequency = flushFrequency
        client._maxQueueSize = maxQueueSize > 0 ? maxQueueSize : DEFAULTS.maxQueueSize
        client._attributionCallback = attributionCallback || PRE_INIT.attributionCallback
        client._deferredDeepLinkCallback = deferredDeepLinkCallback || PRE_INIT.deferredDeepLinkCallback
        client._nativeModules = nativeModules || {}
        client._domain = SwaarmClient._cleanDomain(domain)
        PRE_INIT.attributionCallback = null
        PRE_INIT.deferredDeepLinkCallback = null

        try { await client._initializeDeviceInfo() } catch (e) { SwaarmClient._warn("Device info", e) }
        try { await client._initializeIdentifiers() } catch (e) { SwaarmClient._warn("Identifiers", e) }
        try { await client._loadClockSkew() } catch (e) { SwaarmClient._warn("Clock skew load", e) }
        try { await client._loadPersistedQueue() } catch (e) { SwaarmClient._warn("Queue load", e) }

        client._headers = {
            "user-agent": client._userAgent,
            "content-encoding": "gzip",
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
        }

        try {
            const firstRunRaw = await AsyncStorage.getItem(STORAGE_KEYS.firstRun)
            const isFirstRun = firstRunRaw === null

            if (isFirstRun) {
                if (client._deferredDeepLinkCallback) {
                    await client._checkForDeferredDeepLinks()
                }
                let installReferrer = null
                if (Platform.OS === "ios") {
                    installReferrer = await client._fetchAppleAdsInstallReferrer()
                } else {
                    try { installReferrer = await getInstallReferrer() } catch (e) {
                        SwaarmClient._warn("Install referrer", e)
                    }
                }
                client._enqueueEvent({installReferrer})
                await AsyncStorage.setItem(STORAGE_KEYS.firstRun, "false")
            }

            await client._loadAttributionData()
        } catch (e) {
            SwaarmClient._warn("Bootstrap", e)
        }

        client._enqueueEvent({typeId: "__open"})
        client._initialized = true

        // Drain pre-init buffer preserving each call's original timestamp.
        while (PRE_INIT.pendingEvents.length > 0) {
            const entry = PRE_INIT.pendingEvents.shift()
            if (entry.kind === "event") {
                const [typeId, aggregatedValue, customValue] = entry.args
                client._enqueueEvent({
                    typeId, aggregatedValue, customValue,
                    capturedAtMs: entry.capturedAtMs,
                })
            } else if (entry.kind === "purchase") {
                const [typeId, revenue, currency, receiptOrToken, androidPurchaseId] = entry.args
                client._enqueueEvent({
                    typeId, revenue, currency, receiptOrToken, androidPurchaseId,
                    capturedAtMs: entry.capturedAtMs,
                })
            }
        }

        if (SwaarmClient._debug) {
            console.log(
                `SwaarmSDK >> Started on domain ${client._domain}\n` +
                `  vendorId: ${client._vendorId}\n` +
                `  advertisingId: ${client._advertisingId}\n` +
                `  user agent: ${client._userAgent}\n` +
                `  osv: ${client._osv}\n` +
                `  system name: ${client._systemName}\n` +
                `  clock skew: ${client._clockSkewMs} ms\n` +
                `  flush frequency: ${client._flushFrequency}s\n` +
                `  queue size: ${client._events.length}/${client._maxQueueSize}`
            )
        }

        client._subscribeAppState()
        if (client._flushFrequency > 0) {
            await client._start()
        }
        client._scheduleAttributionFetch()

        return client
    }

    // =========================================================================
    // Device info & identifiers
    // =========================================================================

    async _initializeDeviceInfo() {
        const systemName = typeof getSystemName === "function" ? (getSystemName() || "") : ""
        const osv = typeof getSystemVersion === "function" ? (getSystemVersion() || "") : ""
        let manufacturer = ""
        let model = ""
        try { manufacturer = (await getManufacturer()) || "" } catch (_) {}
        try { model = (await getModel()) || "" } catch (_) {}
        if (systemName.toLowerCase() === "ios" && !manufacturer) {
            manufacturer = "Apple"
        }
        this._systemName = systemName
        this._osv = osv
        this._userAgent = `SwaarmSDK Os##${systemName}##;Osv##${osv}##;Muf##${manufacturer}##;Model##${model}##;`
    }

    async _initializeIdentifiers() {
        let platformVendorId = null
        try {
            platformVendorId = await this._resolvePlatformVendorId()
        } catch (e) {
            SwaarmClient._warn("Platform vendor id", e)
        }

        if (platformVendorId) {
            this._vendorId = platformVendorId
        } else {
            let storedVendorId = await AsyncStorage.getItem(STORAGE_KEYS.vendorId)
            if (!storedVendorId) {
                storedVendorId = uuid.v4()
                await AsyncStorage.setItem(STORAGE_KEYS.vendorId, storedVendorId)
            }
            this._vendorId = storedVendorId
        }

        try {
            this._advertisingId = await this._resolveAdvertisingId()
        } catch (e) {
            SwaarmClient._warn("Advertising id", e)
            this._advertisingId = null
        }
    }

    /**
     * Resolves the platform-specific vendor id: identifierForVendor on iOS and
     * the App Set ID on Android (via the optional `appSetId` native module
     * passed in `init`'s `nativeModules`). Falls back to `getUniqueId()`
     * (SSAID on Android) when the module is not provided.
     */
    async _resolvePlatformVendorId() {
        if (Platform.OS === "ios") {
            try { const id = await getUniqueId(); return id || null } catch (_) { return null }
        }
        if (Platform.OS === "android") {
            const appSetId = this._nativeModules.appSetId || null
            if (appSetId) {
                try {
                    if (typeof appSetId.getAppSetId === "function") {
                        const id = await appSetId.getAppSetId()
                        if (id) return id
                    } else if (typeof appSetId.getAppSetIdAsync === "function") {
                        const id = await appSetId.getAppSetIdAsync()
                        if (id) return id
                    } else if (typeof appSetId.getAsync === "function") {
                        const result = await appSetId.getAsync()
                        const id = result && (result.id || result)
                        if (typeof id === "string" && id.length > 0) return id
                    }
                } catch (e) {
                    SwaarmClient._warn("App Set ID lookup failed", e)
                }
            }
            try { const id = await getUniqueId(); return id || null } catch (_) { return null }
        }
        return null
    }

    /**
     * Resolves the real advertising identifier (IDFA on iOS, GAID on Android)
     * via the optional `idfaAaid` native module passed in `nativeModules`.
     * Returns `null` when the module is not provided, when ad tracking is
     * limited, or when the OS hands back the zero UUID.
     */
    async _resolveAdvertisingId() {
        if (Platform.OS !== "ios" && Platform.OS !== "android") return null
        const idfaAaid = this._nativeModules.idfaAaid || null
        if (!idfaAaid || typeof idfaAaid.getAdvertisingInfo !== "function") return null
        try {
            const info = await idfaAaid.getAdvertisingInfo()
            if (!info) return null
            if (info.isAdTrackingLimited === true) return null
            const id = typeof info === "string" ? info : info.id
            if (!id || typeof id !== "string") return null
            if (id.replace(/[-0]/g, "").length === 0) return null
            return id
        } catch (e) {
            SwaarmClient._warn("Advertising id lookup failed", e)
            return null
        }
    }

    // =========================================================================
    // Event queue & persistence
    // =========================================================================

    async _loadPersistedQueue() {
        const raw = await AsyncStorage.getItem(STORAGE_KEYS.eventQueue)
        if (!raw) return
        try {
            const parsed = JSON.parse(raw)
            if (!Array.isArray(parsed)) return
            const cleaned = parsed.filter(e => e && typeof e === "object")
            this._events = cleaned.slice(-this._maxQueueSize)
            if (SwaarmClient._debug) {
                console.log(`SwaarmSDK >> Restored ${this._events.length} queued events`)
            }
        } catch (e) {
            SwaarmClient._warn("Failed to parse persisted event queue", e)
        }
    }

    _schedulePersistQueue() {
        if (this._queuePersistPending) return
        this._queuePersistPending = true
        setTimeout(() => {
            this._queuePersistPending = false
            AsyncStorage.setItem(STORAGE_KEYS.eventQueue, JSON.stringify(this._events))
                .catch(e => SwaarmClient._warn("Failed to persist event queue", e))
        }, 0)
    }

    _enqueueEvent({
        typeId = null,
        aggregatedValue = 0.0,
        customValue = "",
        revenue = 0.0,
        currency = null,
        receiptOrToken = null,
        androidPurchaseId = null,
        installReferrer = null,
        capturedAtMs = Date.now(),
    } = {}) {
        let iosReceipt = {}
        let androidReceipt = {}
        if (receiptOrToken) {
            if (this._systemName === "iOS" || this._systemName === "iPadOS") {
                iosReceipt = {receipt: receiptOrToken}
            } else if (this._systemName === "Android") {
                androidReceipt = {token: receiptOrToken, subscriptionId: androidPurchaseId || ""}
            }
        }

        const event = {
            id: uuid.v4(),
            typeId,
            aggregatedValue,
            customValue,
            revenue,
            vendorId: this._vendorId,
            // Finalised at flush time with the latest clock skew.
            clientTime: null,
            osv: this._osv,
            advertisingId: this._advertisingId,
            currency: currency || null,
            iosPurchaseValidation: iosReceipt,
            androidPurchaseValidation: androidReceipt,
            installReferrer: installReferrer
                ? typeof installReferrer === "string"
                    ? {referrer: installReferrer}
                    : installReferrer
                : {},
            _capturedAtMs: capturedAtMs,
        }

        while (this._events.length >= this._maxQueueSize) {
            const dropped = this._events.shift()
            if (SwaarmClient._debug) {
                console.warn(`SwaarmSDK >> Queue full, dropping oldest event id=${dropped && dropped.id}`)
            }
        }

        this._events.push(event)
        if (SwaarmClient._debug) {
            console.log("SwaarmSDK >> Queued event", event)
        }
        this._schedulePersistQueue()
    }

    _freezeEventForWire(event) {
        const {_capturedAtMs, ...payload} = event
        const correctedMs = (_capturedAtMs || Date.now()) + this._clockSkewMs
        // ISOString is always UTC ("...Z"), regardless of device timezone.
        payload.clientTime = new Date(correctedMs).toISOString()
        return payload
    }

    // =========================================================================
    // Flush
    // =========================================================================

    async _sendEvents() {
        if (!this._initialized) return
        if (!this._active) return
        if (this._events.length === 0) return

        const batch = this._events.slice(0, DEFAULTS.batchSize)
        const wireEvents = batch.map(e => this._freezeEventForWire(e))
        const wireTime = new Date(Date.now() + this._clockSkewMs).toISOString()
        const payload = JSON.stringify({time: wireTime, events: wireEvents})
        const body = gzip(payload)

        const requestStart = Date.now()
        let response
        try {
            response = await fetch(this._buildUrl("/sdk"), {
                method: "POST",
                body,
                headers: this._headers,
            })
        } catch (e) {
            SwaarmClient._warn("Network error while sending events; will retry.", e)
            return
        }

        this._updateClockSkewFromResponse(response, requestStart)

        if (!response.ok) {
            SwaarmClient._warn(`Server returned ${response.status} while sending events; will retry.`)
            return
        }

        const batchIds = new Set(batch.map(e => e.id))
        this._events = this._events.filter(e => !batchIds.has(e.id))
        this._schedulePersistQueue()
        if (SwaarmClient._debug) {
            console.log(`SwaarmSDK >> Sent ${batch.length} events; ${this._events.length} remain.`)
        }
    }

    async _start() {
        this._active = true
        await this._sendEvents()
        if (this._flushInterval) {
            clearInterval(this._flushInterval)
            this._flushInterval = null
        }
        this._flushInterval = setInterval(
            () => { this._sendEvents() },
            this._flushFrequency * 1000
        )
    }

    _stopIntervals() {
        if (this._flushInterval) {
            clearInterval(this._flushInterval)
            this._flushInterval = null
        }
        if (this._attributionTimer) {
            clearTimeout(this._attributionTimer)
            this._attributionTimer = null
        }
    }

    // =========================================================================
    // App lifecycle
    // =========================================================================

    _subscribeAppState() {
        if (this._appStateSubscription) return
        if (!AppState || typeof AppState.addEventListener !== "function") return
        this._appStateSubscription = AppState.addEventListener("change", s => this._onAppStateChange(s))
        this._appStateCurrent = AppState.currentState || "active"
    }

    _onAppStateChange(nextState) {
        const prev = this._appStateCurrent
        this._appStateCurrent = nextState

        const enteringForeground = nextState === "active" && prev !== "active"
        const enteringBackground = nextState === "background" && prev !== "background"

        if (enteringForeground) {
            if (this._flushFrequency > 0) {
                this._start().catch(e => SwaarmClient._warn("Foreground resume failed", e))
            }
            this._scheduleAttributionFetch()
            return
        }

        if (enteringBackground) {
            this._stopIntervals()
            // Best-effort final flush; the OS may pause us before it completes.
            this._sendEvents().catch(e => SwaarmClient._warn("Background flush failed", e))
        }
    }

    // =========================================================================
    // Clock skew
    // =========================================================================

    async _loadClockSkew() {
        const raw = await AsyncStorage.getItem(STORAGE_KEYS.clockSkew)
        if (raw === null) return
        const parsed = parseInt(raw, 10)
        if (!Number.isFinite(parsed)) return
        this._clockSkewMs = parsed
    }

    _persistClockSkew() {
        AsyncStorage.setItem(STORAGE_KEYS.clockSkew, String(this._clockSkewMs))
            .catch(e => SwaarmClient._warn("Failed to persist clock skew", e))
    }

    /**
     * Derives the client/server clock skew from the HTTP `Date` response
     * header, compensating for round-trip latency. The `Date` header is always
     * UTC (RFC 7231), so the resulting skew is a pure ms offset from UTC.
     *
     * Only persists when the change exceeds a noise threshold to avoid
     * write amplification from small RTT jitter.
     */
    _updateClockSkewFromResponse(response, requestStart) {
        try {
            if (!response || !response.headers || typeof response.headers.get !== "function") return
            const serverDate = response.headers.get("date")
            if (!serverDate) return
            const serverMs = Date.parse(serverDate)
            if (!Number.isFinite(serverMs)) return
            const requestEnd = Date.now()
            const rttMs = Math.max(0, requestEnd - requestStart)
            const midpointLocalMs = requestStart + Math.floor(rttMs / 2)
            const nextSkew = serverMs - midpointLocalMs
            if (Math.abs(nextSkew - this._clockSkewMs) >= DEFAULTS.clockSkewPersistThresholdMs) {
                this._clockSkewMs = nextSkew
                this._persistClockSkew()
                if (SwaarmClient._debug) {
                    console.log(`SwaarmSDK >> Clock skew updated: ${nextSkew} ms (rtt=${rttMs} ms)`)
                }
            }
        } catch (e) {
            SwaarmClient._warn("Clock skew update failed", e)
        }
    }

    // =========================================================================
    // Attribution
    // =========================================================================

    async _loadAttributionData() {
        const stored = await AsyncStorage.getItem(STORAGE_KEYS.attributionData)
        if (!stored) return
        try {
            this._attributionData = JSON.parse(stored)
            if (SwaarmClient._debug) {
                console.log(`SwaarmSDK >> Restored attribution data: ${stored}`)
            }
        } catch (e) {
            SwaarmClient._warn("Unable to parse cached attribution data", e)
        }
    }

    _scheduleAttributionFetch() {
        if (this._attributionData && this._attributionData.decision) return
        if (this._attributionTimer) {
            clearTimeout(this._attributionTimer)
            this._attributionTimer = null
        }

        let backoffMs = DEFAULTS.attributionFetchInterval * 1000
        const exponent = DEFAULTS.attributionBackoffExponent
        const maxBackoffMs = DEFAULTS.attributionMaxBackoffMs

        const tick = () => {
            if (this._attributionData && this._attributionData.decision) return
            if (!this._active) return
            this._attributionTimer = setTimeout(async () => {
                await this._fetchAttributionData()
                if (this._attributionData && this._attributionData.decision) {
                    if (this._attributionTimer) {
                        clearTimeout(this._attributionTimer)
                        this._attributionTimer = null
                    }
                    return
                }
                const grown = Math.floor(1000 * Math.pow(backoffMs / 1000, exponent))
                backoffMs = Math.min(grown, maxBackoffMs)
                if (SwaarmClient._debug) {
                    console.log(`SwaarmSDK >> Attribution backoff interval: ${backoffMs} ms`)
                }
                tick()
            }, backoffMs)
        }

        tick()
    }

    async _fetchAttributionData() {
        if (!this._vendorId) return
        const url = this._buildUrl(`/attribution-data?vendorId=${encodeURIComponent(this._vendorId)}`)
        if (SwaarmClient._debug) {
            console.log(`SwaarmSDK >> Fetching attribution data from ${url}`)
        }

        const requestStart = Date.now()
        let response
        try {
            response = await fetch(url, {method: "GET", headers: this._headers})
        } catch (e) {
            SwaarmClient._warn("Attribution fetch network error", e)
            return
        }
        this._updateClockSkewFromResponse(response, requestStart)
        if (!response.ok) {
            SwaarmClient._warn(`Attribution fetch returned ${response.status}`)
            return
        }

        let body
        try {
            body = await response.text()
        } catch (e) {
            SwaarmClient._warn("Attribution body read failed", e)
            return
        }
        let data
        try {
            data = JSON.parse(body)
        } catch (e) {
            SwaarmClient._warn("Attribution parse failed", e)
            return
        }

        this._attributionData = data
        if (data && data.decision && this._attributionCallback) {
            try {
                this._attributionCallback(data)
            } catch (e) {
                SwaarmClient._warn("Error in attribution callback", e)
            }
        }

        try {
            await AsyncStorage.setItem(STORAGE_KEYS.attributionData, body)
        } catch (e) {
            SwaarmClient._warn("Attribution persist failed", e)
        }
    }

    // =========================================================================
    // Apple Search Ads attribution (iOS only)
    // =========================================================================

    /**
     * Fetches Apple Search Ads attribution data on first launch (iOS only).
     *
     * Companies that do not use Apple Search Ads can simply omit the optional
     * `nativeModules.adServicesAttribution` reference — this method then
     * silently returns null and never touches Apple's servers.
     *
     * Two native-module shapes are supported:
     *   1. `{ getAttributionToken(): Promise<string> }` (preferred — matches
     *      Apple's `AAAttribution.attributionToken()`). The SDK then exchanges
     *      the token with `https://api-adservices.apple.com/api/v1/`.
     *   2. `{ getAttributionData(): Promise<object> }` for packages that
     *      already perform the Apple API exchange themselves and return the
     *      parsed response.
     *
     * On a successful attribution, returns an InstallReferrer-shaped object
     * with a UTM-formatted `referrer` and unix-seconds `clickTimestamp`.
     */
    async _fetchAppleAdsInstallReferrer() {
        if (Platform.OS !== "ios") return null

        try {
            const checked = await AsyncStorage.getItem(STORAGE_KEYS.appleAdsChecked)
            if (checked) return null
        } catch (_) {}

        const mod = this._nativeModules.adServicesAttribution || null

        try { await AsyncStorage.setItem(STORAGE_KEYS.appleAdsChecked, "true") } catch (_) {}

        if (!mod) {
            if (SwaarmClient._debug) {
                console.log("SwaarmSDK >> Apple Ads: no adServicesAttribution module supplied, skipping")
            }
            return null
        }

        let response = null
        try {
            if (typeof mod.getAttributionToken === "function") {
                const token = await mod.getAttributionToken()
                if (token && typeof token === "string") {
                    response = await this._postAppleAdsToken(token)
                }
            } else if (typeof mod.attributionToken === "function") {
                const token = await mod.attributionToken()
                if (token && typeof token === "string") {
                    response = await this._postAppleAdsToken(token)
                }
            } else if (typeof mod.getAttributionData === "function") {
                response = await mod.getAttributionData()
            } else {
                SwaarmClient._warn("Apple Ads: adServicesAttribution module has no recognised method")
                return null
            }
        } catch (e) {
            SwaarmClient._warn("Apple Ads attribution failed", e)
            return null
        }

        if (!response || response.attribution !== true) {
            if (SwaarmClient._debug) {
                console.log("SwaarmSDK >> Apple Ads: install not attributed to a campaign")
            }
            return null
        }

        const referrer = SwaarmClient._buildAppleAdsUtm(response)
        const clickTimestamp = SwaarmClient._parseAppleAdsClickDate(response.clickDate)
        if (SwaarmClient._debug) {
            console.log(`SwaarmSDK >> Apple Ads attributed install: ${referrer}`)
        }
        return clickTimestamp != null ? {referrer, clickTimestamp} : {referrer}
    }

    async _postAppleAdsToken(token) {
        const endpoint = DEFAULTS.appleAdsEndpoint
        const maxRetries = DEFAULTS.appleAdsMaxRetries
        const retryDelayMs = DEFAULTS.appleAdsRetryDelayMs

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            let response
            try {
                response = await fetch(endpoint, {
                    method: "POST",
                    body: token,
                    headers: {"content-type": "text/plain"},
                })
            } catch (e) {
                SwaarmClient._warn(`Apple Ads: request failed (attempt ${attempt})`, e)
                if (attempt < maxRetries) {
                    await new Promise(r => setTimeout(r, retryDelayMs))
                }
                continue
            }

            // Apple's endpoint returns 404 for ~10s after install — retry.
            if (response.status === 404 && attempt < maxRetries) {
                if (SwaarmClient._debug) {
                    console.log(`SwaarmSDK >> Apple Ads: 404 (attempt ${attempt}), retrying in ${retryDelayMs}ms`)
                }
                await new Promise(r => setTimeout(r, retryDelayMs))
                continue
            }

            if (!response.ok) {
                SwaarmClient._warn(`Apple Ads: HTTP ${response.status}`)
                return null
            }

            try {
                return await response.json()
            } catch (e) {
                SwaarmClient._warn("Apple Ads: failed to parse response", e)
                return null
            }
        }
        return null
    }

    static _buildAppleAdsUtm(response) {
        const parts = ["utm_source=appleads"]
        if (response.campaignId != null) parts.push(`utm_campaign=${response.campaignId}`)
        if (response.adGroupId != null) parts.push(`utm_adgroup=${response.adGroupId}`)
        if (response.adId != null) parts.push(`utm_adid=${response.adId}`)
        if (response.keywordId != null) parts.push(`utm_keyword=${response.keywordId}`)
        return parts.join("&")
    }

    static _parseAppleAdsClickDate(raw) {
        if (!raw || typeof raw !== "string") return null
        const ms = Date.parse(raw)
        if (!Number.isFinite(ms)) return null
        return Math.floor(ms / 1000)
    }

    // =========================================================================
    // Deferred deep links
    // =========================================================================

    async _checkForDeferredDeepLinks() {
        const requestStart = Date.now()
        let response
        try {
            response = await fetch(this._buildUrl("/deeplink"), {method: "GET", headers: this._headers})
        } catch (e) {
            SwaarmClient._warn("Deferred deep link fetch failed", e)
            return
        }
        this._updateClockSkewFromResponse(response, requestStart)
        if (!response.ok) return

        let deepLink
        try {
            deepLink = await response.text()
        } catch (e) {
            SwaarmClient._warn("Deferred deep link body read failed", e)
            return
        }
        try {
            this._deferredDeepLinkCallback(deepLink)
        } catch (e) {
            SwaarmClient._warn("Exception in deferred deep link callback", e)
        }
        if (SwaarmClient._debug) {
            console.log(`SwaarmSDK >> Deferred deep link received: ${deepLink}`)
        }
    }

    // =========================================================================
    // Misc helpers
    // =========================================================================

    static _cleanDomain(domain) {
        return domain
            .replace(/^http:\/\//, "")
            .replace(/^https:\/\//, "")
            .replace(/\/+$/, "")
    }

    _buildUrl(path) {
        const protocol = this._domain.startsWith("localhost") ? "http://" : "https://"
        return `${protocol}${this._domain}${path}`
    }

    static _warn(message, error) {
        if (!SwaarmClient._debug) return
        if (error !== undefined) {
            console.warn(`SwaarmSDK >> ${message}`, error)
        } else {
            console.warn(`SwaarmSDK >> ${message}`)
        }
    }
}

export {SwaarmClient}
