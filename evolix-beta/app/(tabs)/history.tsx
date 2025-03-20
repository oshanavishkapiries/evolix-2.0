import React, { useEffect, useState } from 'react';
import { View, StyleSheet, FlatList, Text, TouchableOpacity, Image } from 'react-native';
import { Stack, router } from 'expo-router';
import { WatchHistoryService } from '../services/watchHistory';
import { WatchHistoryItem } from '../types/watchHistory';

export default function HistoryScreen() {
    const [history, setHistory] = useState<WatchHistoryItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadHistory();
    }, []);

    const loadHistory = async () => {
        try {
            setLoading(true);
            const historyState = await WatchHistoryService.getWatchHistory();
            setHistory(historyState.items);
        } catch (error) {
            console.error('Error loading history:', error);
        } finally {
            setLoading(false);
        }
    };

    const formatTime = (seconds: number): string => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainingSeconds = seconds % 60;

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
        }
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    };

    const handleItemPress = (item: WatchHistoryItem) => {
        router.push({
            pathname: "/extract/[provider]",
            params: {
                provider: item.provider,
                videoUrl: item.videoUrl,
                subtitleUrl: item.subtitleUrl,
                posterUrl: item.thumbnailUrl,
                title: `${item.seriesTitle} - S${item.seasonNumber}E${item.episodeNumber}`,
                episodeId: item.episodeId,
                seriesId: item.seriesId,
                seriesTitle: item.seriesTitle,
                episodeTitle: item.episodeTitle,
                episodeNumber: item.episodeNumber,
                seasonNumber: item.seasonNumber,
                thumbnailUrl: item.thumbnailUrl,
                initialTimestamp: item.timestamp
            }
        });
    };

    const renderItem = ({ item }: { item: WatchHistoryItem }) => (
        <TouchableOpacity
            style={styles.item}
            onPress={() => handleItemPress(item)}
        >
            <Image
                source={{ uri: item.thumbnailUrl }}
                style={styles.thumbnail}
                resizeMode="cover"
            />
            <View style={styles.itemContent}>
                <Text style={styles.seriesTitle}>{item.seriesTitle}</Text>
                <Text style={styles.episodeTitle}>
                    S{item.seasonNumber}E{item.episodeNumber} - {item.episodeTitle}
                </Text>
                <Text style={styles.timestamp}>
                    Last watched: {formatTime(item.timestamp)}
                </Text>
            </View>
        </TouchableOpacity>
    );

    return (
        <>
            <Stack.Screen
                options={{
                    title: 'Watch History',
                    headerStyle: { backgroundColor: '#000000' },
                    headerTintColor: '#ffffff',
                }}
            />
            <View style={styles.container}>
                {loading ? (
                    <Text style={styles.loadingText}>Loading history...</Text>
                ) : history.length === 0 ? (
                    <Text style={styles.emptyText}>No watch history yet</Text>
                ) : (
                    <FlatList
                        data={history}
                        renderItem={renderItem}
                        keyExtractor={(item) => item.id}
                        contentContainerStyle={styles.list}
                    />
                )}
            </View>
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000000',
    },
    list: {
        padding: 16,
    },
    item: {
        flexDirection: 'row',
        marginBottom: 16,
        backgroundColor: '#1a1a1a',
        borderRadius: 8,
        overflow: 'hidden',
    },
    thumbnail: {
        width: 120,
        height: 68,
    },
    itemContent: {
        flex: 1,
        padding: 12,
    },
    seriesTitle: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: 'bold',
        marginBottom: 4,
    },
    episodeTitle: {
        color: '#cccccc',
        fontSize: 14,
        marginBottom: 4,
    },
    timestamp: {
        color: '#888888',
        fontSize: 12,
    },
    loadingText: {
        color: '#ffffff',
        textAlign: 'center',
        marginTop: 20,
    },
    emptyText: {
        color: '#888888',
        textAlign: 'center',
        marginTop: 20,
    },
}); 