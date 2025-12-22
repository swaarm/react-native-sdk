import {StatusBar} from 'expo-status-bar';
import {Button, StyleSheet, Text, View} from 'react-native';
import {SwaarmClient} from "./Swaarm";
import {useEffect} from "react";

export default function App() {
    useEffect(() => {
        SwaarmClient.initMultiPlatform("localhost", "123", true, (data)=>{
            if(data.decision == "PASSED"){
                console.log("Attributed to ", data)
            }
        })
    }, []);

    return (
        <View style={styles.container}>
            <Button onPress={() => SwaarmClient.event("test")} title="Click to send simple event"></Button>
            <br/>
            <Button onPress={() => SwaarmClient.event("earned_points", 100, '{"packageType": "premium"}')}
                    title="Click to send event with data"></Button>
            <br/>
            <Button onPress={() => SwaarmClient.purchase("subscribed_to_premium", 19.99, "USD")}
                    title="Click to send purchase event"></Button>

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
