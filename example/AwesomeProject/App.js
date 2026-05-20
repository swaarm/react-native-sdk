import {StatusBar} from 'expo-status-bar';
import {Button, StyleSheet, View} from 'react-native';
import {SwaarmClient} from "@swaarm/swaarm-sdk";
import {useEffect} from "react";

// Optional native-id modules. Import them at the host-app level so Metro
// bundles them, then pass them to the SDK via `nativeModules`. If they are
// not installed, drop the imports and the corresponding `nativeModules`
// entries — the SDK will gracefully skip them.
// import AppSetID from "react-native-app-set-id";
// import ReactNativeIdfaAaid from "react-native-idfa-aaid";
// import AppleAdsAttribution from "react-native-apple-ads-attribution";

export default function App() {
    useEffect(() => {
        SwaarmClient.init("example.swaarm.com", "<token>", {
            debug: true,
            attributionCallback: (data) => {
                if (data.decision === "PASSED") {
                    console.log("Attributed to", data);
                }
            },
            deferredDeepLinkCallback: (route) => {
                console.log("Deferred deep link:", route);
            },
            // nativeModules: {
            //     appSetId: AppSetID,
            //     idfaAaid: ReactNativeIdfaAaid,
            //     // iOS only — wire this in if you run Apple Search Ads campaigns.
            //     // Omit it entirely if you do not; the SDK then skips Apple Ads
            //     // attribution and never contacts Apple's servers.
            //     adServicesAttribution: AppleAdsAttribution,
            // },
        });
    }, []);

    return (
        <View style={styles.container}>
            <Button onPress={() => SwaarmClient.event("test")} title="Send simple event"/>
            <Button
                onPress={() => SwaarmClient.event("earned_points", 100, '{"packageType": "premium"}')}
                title="Send event with data"/>
            <Button
                onPress={() => SwaarmClient.purchase("subscribed_to_premium", 19.99, "USD")}
                title="Send purchase event"/>
            <StatusBar style="auto"/>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
        alignItems: 'center',
        justifyContent: 'center',
    },
});
