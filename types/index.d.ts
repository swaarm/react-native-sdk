export class SwaarmClient {
    /**
     * Registers a purchase or any other monetary event in the app
     * @param typeId - the mapping id of the event, can be found under App (edit) > Events
     * @param revenue - the amount paid (e.g. 12.42)
     * @param currency - the currency used (e.g. USD) - defaults to Swaarm platform currency
     * @param receiptOrToken - if payment is done through Apple, the receipts can be attached for validation
     * @param androidPurchaseId - if payment is done through PlayServices, the purchase id can be attached for validation
     */
    static purchase(typeId: string, revenue: number, currency: any, receiptOrToken: any, androidPurchaseId: any): void;
    /**
     * Registers an event in Swaarm
     * @param typeId - the mapping id of the event, can be found under App (edit) > Events
     * @param aggregatedValue - a numeric value that can be summed/averaged (e.g. number of coins earned)
     * @param customValue - any data that should be recorded together with the event, JSON serialization is preferred
     * (e.g. '{"customerType": "premium", "enabledFeatures": ["A", "B", "C"]}')
     */
    static event(typeId: string, aggregatedValue?: number, customValue?: string): void;
    /**
     * Constructs a new Swaarm client for a multi-platform app that can be used to register events.
     * @param domain - your tracking domain, find it in the Swaarm Settings > Domains tab
     * @param token - the token associated with your store app
     * @param enableLogs - flag that enables the logging of the SDK actions
     * @returns {Promise<SwaarmClient>} the instance for the Swaarm client
     */
    static initMultiPlatform(domain: string, token: string, enableLogs: boolean): Promise<SwaarmClient>;
    /**
     * Constructs a new Swaarm client for a multi-platform app that can be used to register events.
     * @param domain - your tracking domain, find it in the Swaarm Settings > Domains tab
     * @param iosToken - the token associated with your iOS store app
     * @param androidToken - the token associated with your android store app
     * @param enableLogs - flag that enables the logging of the SDK actions
     * @param attributionCallback - a method to be called once the attribution data is available
     * @returns {Promise<SwaarmClient>} the instance for the Swaarm client
     */
    static init(domain: string, iosToken?: string, androidToken?: string, enableLogs?: boolean, attributionCallback?: Function): Promise<SwaarmClient>;
    static batchSize: number;
    static flushFrequency: number;
    static debug: boolean;
    static addEvent(typeId: any, aggregatedValue: number, customValue: string, revenue: number, currency: any, receiptOrToken: any, androidPurchaseId: any): void;
    static start(): void;
    static stop(): void;
    static log(enabled: any): void;
    events: any[];
    active: boolean;
    sendEvents(): void;
    getBreakpoints(): Promise<{}>;
}
