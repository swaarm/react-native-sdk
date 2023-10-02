import { gzip } from 'pako';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { getUniqueId, getSystemVersion, getUserAgent, getSystemName } from 'react-native-device-info';
import AsyncStorage from '@react-native-async-storage/async-storage';


export const asyncTimeout = (ms: number) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};


class SwaarmClient {
  private static instance: SwaarmClient;
  private static batchSize: number = 50;
  private static flushFrequency: number = 10;
  ua: string;
  osv: string;
  systemName: string;
  headers: Record<string, string>;
  events: Array<object> = [];
  domain: string;
  vendorId: String;
  isCollecting: false;
  // breakpoints: Array<Breakpoint>;
  active: boolean = false;

  private constructor() { }


  public static async init(domain: string, token: string): Promise<SwaarmClient> {
    console.log("init_sdk");
    if (!SwaarmClient.instance) {
      SwaarmClient.instance = new SwaarmClient();
      SwaarmClient.instance.ua = await getUserAgent();
      SwaarmClient.instance.osv = getSystemVersion();
      SwaarmClient.instance.systemName = getSystemName();
      SwaarmClient.instance.domain = domain;
      SwaarmClient.instance.vendorId = await getUniqueId();
      SwaarmClient.instance.headers = {
        'user-agent': SwaarmClient.instance.ua,
        'content-encoding': 'gzip',
        'authorization': `Bearer ${token}`,
        'content-type': 'application/json'
      };

    }

    try {
      if ((await AsyncStorage.getItem("INSTALLED")) !== null) {
        // already installed
      } else {
        SwaarmClient.addEvent();
        await AsyncStorage.setItem("INSTALLED", "yes");
      }
      SwaarmClient.addEvent("__open");
    } catch (e: any) {
      console.log(e.Message);
    }



    console.log(`Starting with vendorId ${SwaarmClient.instance.vendorId}, collecting ${SwaarmClient.instance.isCollecting}`);
    //console.log(`Starting with vendorId ${SwaarmClient.instance.vendorId}, collecting ${SwaarmClient.instance.isCollecting}, breakpoints ${SwaarmClient.instance.breakpoints}`);
    if (SwaarmClient.flushFrequency > 0) {
      SwaarmClient.start();
    }

    return SwaarmClient.instance;
  }

  sendEvents() {
    if (!SwaarmClient.instance.active) {
      return;
    }
    try {
      if (SwaarmClient.instance.events.length > 0) {

        var batch = SwaarmClient.instance.events.slice(0, SwaarmClient.batchSize);
        Promise.resolve(fetch(`https://${SwaarmClient.instance.domain}/sdk`, {
          method: "POST",
          body: gzip(JSON.stringify(
            {
              'time': (new Date()).toISOString(),
              'events': batch
            }
          )), headers: SwaarmClient.instance.headers
        }));
        SwaarmClient.instance.events = SwaarmClient.instance.events.filter((item) => batch.indexOf(item) == -1);
      }

      //  var bp = getBreakpoint();
      // if (breakpoints.isNotEmpty || isCollecting) {
      //   var bp = getBreakpoint();

      //   if (bp != _currentBreakpoint) {
      //     _currentBreakpoint = bp;
      //     if (isCollecting) {
      //       saveBreakpoint(bp);
      //     }
      //     if (breakpoints.containsKey(bp)) {
      //       addEvent(typeId: breakpoints[bp]);
      //     }
      //   }
      // }
    } catch (e: any) {
      console.log(e.Message);
    }
    setTimeout(SwaarmClient.instance.sendEvents, 1000 * SwaarmClient.flushFrequency);
  }



  async getBreakpoints() {
    const response = await fetch(`${SwaarmClient.instance.domain}/sdk-tracked-breakpoints`, { headers: SwaarmClient.instance.headers })
    const breakpoints = (await response.json())['viewBreakpoints'];
    var result = {};
    for (const bp in breakpoints) {
      result[bp['viewName']] = bp['eventType'];
    }
    return result;
  }



  static purchase(typeId?: string | undefined, revenue: number = 0.0, currency?: string | undefined, receiptOrToken?: string | undefined, androidPurchaseId?: string | undefined) {
    SwaarmClient.addEvent(typeId, 0, '', revenue, currency, receiptOrToken, androidPurchaseId);
  }
  static event(typeId?: string | undefined, aggregatedValue: number = 0.0, customValue: string = '') {
    SwaarmClient.addEvent(typeId, aggregatedValue, customValue);
  }


  static addEvent(typeId?: string | undefined, aggregatedValue: number = 0.0, customValue: string = '', revenue: number = 0.0, currency?: string | undefined, receiptOrToken?: string | undefined, androidPurchaseId?: string | undefined) {
    var iosReceipt: Record<string, string> = {};
    var androidReceipt: Record<string, string> = {};
    if (receiptOrToken) {
      if (SwaarmClient.instance.systemName === 'iOS') {
        iosReceipt = { 'receipt': (receiptOrToken ?? "") };
      } else if (SwaarmClient.instance.systemName === 'Android') {
        androidReceipt = { 'token': (receiptOrToken ?? ""), 'subscriptionId': (androidPurchaseId ?? "") };
      }
    }


    var event = {
      'id': uuidv4(),
      'typeId': typeId,
      'aggregatedValue': aggregatedValue,
      'customValue': customValue,
      'revenue': revenue,
      'vendorId': SwaarmClient.instance.vendorId,
      'clientTime': (new Date()).toISOString(),
      'osv': SwaarmClient.instance.osv,
      'currency': currency,
      'iosPurchaseValidation': iosReceipt,
      'androidPurchaseValidation': androidReceipt,
    };
    SwaarmClient.instance.events.push(event);
  }


  static start() {
    if (!SwaarmClient.instance.active) {
      SwaarmClient.instance.active = true;
      SwaarmClient.instance.sendEvents();
    }
  }

  static stop() {
    if (SwaarmClient.instance.active) {
      SwaarmClient.instance.active = false;
    }

  }
}

export { SwaarmClient };
