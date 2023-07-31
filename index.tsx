import { gzip } from 'pako';
import { v4 as uuidv4 } from 'uuid';
import { getUniqueId, getSystemVersion, getUserAgent } from 'react-native-device-info';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createWorker } from 'web-worker-helper';


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
  headers: Record<string, string>;
  events: Array<object>;
  domain: string;
  vendorId: String;
  isCollecting: false;
  // breakpoints: Array<Breakpoint>;
  active: boolean = false;

  private constructor() { }


  public static async init(token: string, domain: string): Promise<SwaarmClient> {
    if (!SwaarmClient.instance) {
      SwaarmClient.instance = new SwaarmClient();
      SwaarmClient.instance.ua = await getUserAgent();
      SwaarmClient.instance.osv = getSystemVersion();
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

    } catch (_) {
      // pass
    }


    console.log(`Starting with vendorId ${SwaarmClient.instance.vendorId}, collecting ${SwaarmClient.instance.isCollecting}`);
    //console.log(`Starting with vendorId ${SwaarmClient.instance.vendorId}, collecting ${SwaarmClient.instance.isCollecting}, breakpoints ${SwaarmClient.instance.breakpoints}`);
    if (SwaarmClient.flushFrequency > 0) {
      SwaarmClient.start();
    }

    return SwaarmClient.instance;
  }

  async sendEvents() {
    if (!SwaarmClient.instance.active) {
      return;
    }
    try {
      if (SwaarmClient.instance.events.length > 0) {
        var batch = SwaarmClient.instance.events.slice(0, SwaarmClient.batchSize);
        await fetch(`${SwaarmClient.instance.domain}/sdk`, {
          method: "POST",
          body: gzip(JSON.stringify(
            {
              'time': Date.prototype.toISOString(),
              'events': batch
            }
          )), headers: SwaarmClient.instance.headers
        });
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
    } catch (_) {
      // pass
    }
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

  static addEvent(typeId?: string | undefined, aggregatedValue: number = 0.0, customValue: string = '', revenue: number = 0.0, currency?: string | undefined, iosReceipt?: string | undefined, androidReceipt?: string | undefined) {
    SwaarmClient.instance.events.push({
      'id': uuidv4(),
      'typeId': typeId,
      'aggregatedValue': aggregatedValue,
      'customValue': customValue,
      'revenue': revenue,
      'vendorId': SwaarmClient.instance.vendorId,
      'clientTime': Date.prototype.toISOString(),
      'osv': SwaarmClient.instance.osv,
      'currency': currency,
      'iosPurchaseValidation': { 'receipt': iosReceipt },
      'androidPurchaseValidation': { 'receipt': androidReceipt },
    });
  }


  static start() {
    if (SwaarmClient.instance.active) {
      createWorker(async () => {
        while (SwaarmClient.instance.active) {
          await SwaarmClient.instance.sendEvents();
          await new Promise(r => setTimeout(r, SwaarmClient.flushFrequency * 1000));
        }
      });
    }
  }

  static stop() {
    if (SwaarmClient.instance.active) {
      SwaarmClient.instance.active = false;
    }

  }
}

export { SwaarmClient };
