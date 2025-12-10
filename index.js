import {gzip} from "pako"
import uuid from "react-native-uuid"
import {
    getSystemVersion,
    getUserAgent,
    getSystemName,
    getInstallReferrer
} from "react-native-device-info"
import AsyncStorage from "@react-native-async-storage/async-storage"


class SwaarmClient {
    /**
     * Registers a purchase or any other monetary event in the app
     * @param typeId - the mapping id of the event, can be found under App (edit) > Events
     * @param revenue - the amount paid (e.g. 12.42)
     * @param currency - the currency used (e.g. USD) - defaults to Swaarm platform currency
     * @param receiptOrToken - if payment is done through Apple, the receipts can be attached for validation
     * @param androidPurchaseId - if payment is done through PlayServices, the purchase id can be attached for validation
     */
    static purchase(
        typeId,
        revenue = 0.0,
        currency,
        receiptOrToken,
        androidPurchaseId
    ) {
        if (SwaarmClient.debug) {
            console.log(`Firing purchase event "${typeId}" with revenue=${revenue} and currency=${currency}`)
        }
        SwaarmClient.addEvent(
            typeId,
            0,
            "",
            revenue,
            currency,
            receiptOrToken,
            androidPurchaseId
        )
    }

    /**
     * Registers an event in Swaarm
     * @param typeId - the mapping id of the event, can be found under App (edit) > Events
     * @param aggregatedValue - a numeric value that can be summed/averaged (e.g. number of coins earned)
     * @param customValue - any data that should be recorded together with the event, JSON serialization is preferred
     * (e.g. '{"customerType": "premium", "enabledFeatures": ["A", "B", "C"]}')
     */
    static event(typeId, aggregatedValue = 0.0, customValue = "") {
        if (SwaarmClient.debug) {
            console.log(`Firing event "${typeId}" with aggregatedValue=${aggregatedValue} and customValue=${customValue}`)
        }
        SwaarmClient.addEvent(typeId, aggregatedValue, customValue)
    }

    /**
     * Constructs a new Swaarm client for a multi-platform app that can be used to register events.
     * @param domain - your tracking domain, find it in the Swaarm Settings > Domains tab
     * @param token - the token associated with your store app
     * @param enableLogs - flag that enables the logging of the SDK actions
     * @returns {Promise<SwaarmClient>} the instance for the Swaarm client
     */
    static async initMultiPlatform(domain, token, enableLogs) {
        await SwaarmClient.init(domain, token, token, enableLogs)
    }

    /**
     * Constructs a new Swaarm client for a multi-platform app that can be used to register events.
     * @param domain - your tracking domain, find it in the Swaarm Settings > Domains tab
     * @param iosToken - the token associated with your iOS store app
     * @param androidToken - the token associated with your android store app
     * @param enableLogs - flag that enables the logging of the SDK actions
     * @returns {Promise<SwaarmClient>} the instance for the Swaarm client
     */
    static async init(domain, iosToken, androidToken, enableLogs) {
        if (!SwaarmClient.instance) {
            SwaarmClient.instance = new SwaarmClient()
            SwaarmClient.instance.ua = await getUserAgent()
            SwaarmClient.instance.osv = getSystemVersion()
            SwaarmClient.instance.systemName = getSystemName()
            SwaarmClient.instance.domain = domain
            SwaarmClient.instance.referrer = await getInstallReferrer()
            SwaarmClient.instance.debug = enableLogs
            let token = SwaarmClient.instance.systemName.toLowerCase() === "android" ? androidToken : iosToken
            SwaarmClient.instance.headers = {
                "user-agent": SwaarmClient.instance.ua,
                "content-encoding": "gzip",
                authorization: `Bearer ${token}`,
                "content-type": "application/json"
            }
        }

        try {
            let userId = await AsyncStorage.getItem("__SWAARM_USER_ID")
            if (userId == null) {
                userId = uuid.v4()
                await AsyncStorage.setItem("__SWAARM_USER_ID", userId)
                if (SwaarmClient.debug) {
                    console.log(`SwaarmSDK >> SwaarmClient initialized for user ${userId}`)
                }
            }
            SwaarmClient.instance.vendorId = userId;
            if ((await AsyncStorage.getItem("__SWAARM_INSTALLED")) !== null) {
                // already installed
                if (SwaarmClient.debug) {
                    console.log(`SwaarmSDK >> The app has previously been installed`)
                }
            } else {
                SwaarmClient.addEvent()
                await AsyncStorage.setItem("__SWAARM_INSTALLED", "true")
                if (SwaarmClient.debug) {
                    console.log(`SwaarmSDK >> This is the first install for ${userId}`)
                }
            }
            SwaarmClient.addEvent("__open")
        } catch (e) {
            if (SwaarmClient.debug) {
                console.warn(`SwaarmSDK >> Error while initializing Swaarm SDK`, e)
            }
        }

        if (SwaarmClient.debug) {
            console.log(
                `SwaarmSDK >> Swaarm SDK initialized with vendorId ${SwaarmClient.instance.vendorId}, collecting ${SwaarmClient.instance.isCollecting}`
            )
        }
        if (SwaarmClient.flushFrequency > 0) {
            SwaarmClient.start()
        }

        return SwaarmClient.instance
    }

    static batchSize = 50
    static flushFrequency = 100
    static debug = false
    events = []
    active = false

    constructor() {
    }

    sendEvents() {
        if (!SwaarmClient.instance.active) {
            return
        }
        try {
            if (SwaarmClient.instance.events.length > 0) {
                const batch = SwaarmClient.instance.events.slice(
                    0,
                    SwaarmClient.batchSize
                );
                var url = SwaarmClient.instance.domain.startsWith("http") ? SwaarmClient.instance.domain : "http://" + SwaarmClient.instance.domain
                if (url.endsWith("/")) {
                    url = url.substring(0, url.length - 1)
                }
                Promise.resolve(
                    fetch(`${url}/sdk`, {
                        method: "POST",
                        body: gzip(
                            JSON.stringify({
                                time: new Date().toISOString(),
                                events: batch
                            })
                        ),
                        headers: SwaarmClient.instance.headers
                    })
                )
                SwaarmClient.instance.events = SwaarmClient.instance.events.filter(
                    item => batch.indexOf(item) === -1
                )
            }
        } catch (e) {
            if (SwaarmClient.debug) {
                console.warn(`Error while sending events`, e)
            }
        }
        setTimeout(
            SwaarmClient.instance.sendEvents,
            SwaarmClient.flushFrequency
        )
    }

    async getBreakpoints() {
        const response = await fetch(
            `${SwaarmClient.instance.domain}/sdk-tracked-breakpoints`,
            {headers: SwaarmClient.instance.headers}
        )
        const breakpoints = (await response.json())["viewBreakpoints"]
        const result = {};
        for (const bp in breakpoints) {
            result[bp["viewName"]] = bp["eventType"]
        }
        return result
    }


    static addEvent(
        typeId,
        aggregatedValue = 0.0,
        customValue = "",
        revenue = 0.0,
        currency,
        receiptOrToken,
        androidPurchaseId
    ) {
        let iosReceipt = {};
        let androidReceipt = {};
        if (receiptOrToken) {
            if (SwaarmClient.instance.systemName === "iOS") {
                iosReceipt = {receipt: receiptOrToken ?? ""}
            } else if (SwaarmClient.instance.systemName === "Android") {
                androidReceipt = {
                    token: receiptOrToken ?? "",
                    subscriptionId: androidPurchaseId ?? ""
                }
            }
        }

        const event = {
            id: uuid.v4(),
            typeId: typeId,
            aggregatedValue: aggregatedValue,
            customValue: customValue,
            revenue: revenue,
            vendorId: SwaarmClient.instance.vendorId,
            clientTime: new Date().toISOString(),
            osv: SwaarmClient.instance.osv,
            currency: currency,
            iosPurchaseValidation: iosReceipt,
            androidPurchaseValidation: androidReceipt,
            installReferrer: {
                referrer: SwaarmClient.instance.referrer
            }
        };
        if (SwaarmClient.debug) {
            console.log(`SwaarmSDK >> Sending event`, event)
        }
        SwaarmClient.instance.events.push(event)
    }

    static start() {
        if (!SwaarmClient.instance.active) {
            SwaarmClient.instance.active = true
            SwaarmClient.instance.sendEvents()
        }
    }

    static stop() {
        if (SwaarmClient.instance.active) {
            SwaarmClient.instance.active = false
        }
    }

    static log(enabled) {
        SwaarmClient.debug = enabled;
    }
}

export {SwaarmClient}
