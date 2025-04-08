import React, { useEffect, useState } from 'react';
import { View, StyleSheet, FlatList, Text, TouchableOpacity, Image, Alert } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { WatchHistoryService } from '../services/watchHistory';
import { WatchHistoryItem } from '../types/watchHistory';
import { Ionicons } from '@expo/vector-icons';

export default function HistoryScreen() {
    const [history, setHistory] = useState<WatchHistoryItem[]>([]);
    const [loading, setLoading] = useState(true);

    useFocusEffect(
        React.useCallback(() => {
            loadHistory();
        }, [])
    );

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

    const handleDeleteItem = async (item: WatchHistoryItem) => {
        Alert.alert(
            "Delete Item",
            "Are you sure you want to delete this item from history?",
            [
                {
                    text: "Cancel",
                    style: "cancel"
                },
                {
                    text: "Delete",
                    style: "destructive",
                    onPress: async () => {
                        try {
                            const historyState = await WatchHistoryService.getWatchHistory();
                            const updatedItems = historyState.items.filter(i => i.id !== item.id);
                            await WatchHistoryService.clearWatchHistory();
                            if (updatedItems.length > 0) {
                                for (const item of updatedItems) {
                                    await WatchHistoryService.addToWatchHistory(item);
                                }
                            }
                            setHistory(updatedItems);
                        } catch (error) {
                            console.error('Error deleting item:', error);
                            Alert.alert("Error", "Failed to delete item");
                        }
                    }
                }
            ]
        );
    };

    const handleDeleteAll = () => {
        Alert.alert(
            "Delete All History",
            "Are you sure you want to delete all watch history?",
            [
                {
                    text: "Cancel",
                    style: "cancel"
                },
                {
                    text: "Delete All",
                    style: "destructive",
                    onPress: async () => {
                        try {
                            await WatchHistoryService.clearWatchHistory();
                            setHistory([]);
                        } catch (error) {
                            console.error('Error clearing history:', error);
                            Alert.alert("Error", "Failed to clear history");
                        }
                    }
                }
            ]
        );
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
            <View style={styles.imageContent}>
                <Image
                    source={{ uri: item.thumbnailUrl }}
                    style={styles.thumbnail}
                    resizeMode="cover"
                />
            </View>
            <View style={styles.itemContent}>
                <Text style={styles.seriesTitle}>{item.seriesTitle}</Text>
                <Text style={styles.episodeTitle}>
                    S{item.seasonNumber}E{item.episodeNumber} - {item.episodeTitle}
                </Text>
                <Text style={styles.timestamp}>
                    Last watched: {formatTime(item.timestamp)}
                </Text>
            </View>
            <TouchableOpacity
                style={styles.deleteButton}
                onPress={() => handleDeleteItem(item)}
            >
                <Ionicons name="trash-outline" size={20} color="#ff4444" />
            </TouchableOpacity>
        </TouchableOpacity>
    );

    return (
        <>
            <Stack.Screen
                options={{
                    title: 'Watch History',
                    headerStyle: { backgroundColor: '#000000' },
                    headerTintColor: '#ffffff',
                    headerRight: () => (
                        <TouchableOpacity
                            onPress={handleDeleteAll}
                            style={styles.deleteAllButton}
                        >
                            <Text style={styles.deleteAllText}>Delete All</Text>
                        </TouchableOpacity>
                    ),
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
    deleteAllText: {
        color: '#ff4444',
        fontSize: 12,
        fontWeight: 'bold',
    },
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
    imageContent: {
        width: 120,
        height: 100,
        overflow: "hidden",
        position: "relative",
    },
    thumbnail: {
        width: "100%",
        height: "100%",
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
    deleteButton: {
        padding: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    deleteAllButton: {
        marginRight: 16,
    },
}); 