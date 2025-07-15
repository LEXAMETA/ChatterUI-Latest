// app/components/buttons/ThemedButton.tsx

import TText from '@components/text/TText'
import { AntDesign } from '@expo/vector-icons'
import { Theme } from '@lib/theme/ThemeManager'
import { ReactNode } from 'react'
import {
    PressableProps,
    TextStyle,
    Pressable,
    ViewStyle,
    StyleSheet,
    Animated,
    useAnimatedValue,
    ActivityIndicator, // Import ActivityIndicator
} from 'react-native'

type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'critical' | 'disabled'
type ButtonSize = 'small' | 'medium' | 'large'; // Add button size type

interface ThemedButtonProps extends Omit<PressableProps, 'style'> {
    labelStyle?: TextStyle
    label?: string
    buttonStyle?: ViewStyle
    opacity?: number
    variant?: ButtonVariant
    iconName?: keyof typeof AntDesign.glyphMap
    iconSize?: number
    iconStyle?: TextStyle
    icon?: ReactNode
    showActivityIndicator?: boolean; // New prop for loading spinner
    size?: ButtonSize; // New prop for button size
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

type ButtonTheme = {
    buttonStyle: ViewStyle
    labelStyle: TextStyle
}

const useButtonTheme = (variant: ButtonVariant, size: ButtonSize): ButtonTheme => { // Pass size to useButtonTheme
    const theme = Theme.useTheme()

    const getPaddingVertical = () => {
        switch (size) {
            case 'small': return theme.spacing.s;
            case 'large': return theme.spacing.l;
            default: return theme.spacing.m;
        }
    };

    const getPaddingHorizontal = () => {
        switch (size) {
            case 'small': return theme.spacing.m;
            case 'large': return theme.spacing.xl2;
            default: return theme.spacing.xl;
        }
    };

    const getFontSize = () => {
        switch (size) {
            case 'small': return theme.fontSize.s;
            case 'large': return theme.fontSize.xl;
            default: return theme.fontSize.m;
        }
    };

    const baseButtonStyle = {
        borderWidth: theme.borderWidth.m,
        paddingVertical: getPaddingVertical(),
        paddingHorizontal: getPaddingHorizontal(),
        borderRadius: theme.borderRadius.m,
    };

    const baseLabelStyle = {
        textAlign: 'center' as 'center', // Explicitly type for StyleSheet
        fontSize: getFontSize(),
    };


    //TODO:
    // Have a lightness checker to figure out whether or not to use light or dark text
    switch (variant) {
        default:
        case 'primary':
            return {
                buttonStyle: {
                    ...baseButtonStyle,
                    backgroundColor: theme.color.primary._500,
                    borderColor: theme.color.primary._100,
                },
                labelStyle: {
                    ...baseLabelStyle,
                    color: theme.color.text._900,
                },
            }
        case 'secondary':
            return {
                buttonStyle: {
                    ...baseButtonStyle,
                    borderColor: theme.color.primary._400,
                },
                labelStyle: {
                    ...baseLabelStyle,
                    color: theme.color.primary._700,
                },
            }
        case 'tertiary':
            return {
                buttonStyle: {
                    ...baseButtonStyle,
                    borderColor: 'rgba(0, 0, 0, 0)',
                },
                labelStyle: {
                    ...baseLabelStyle,
                    color: theme.color.text._200,
                },
            }
        case 'critical':
            return {
                buttonStyle: {
                    ...baseButtonStyle,
                    borderColor: theme.color.error._400,
                },
                labelStyle: {
                    ...baseLabelStyle,
                    color: theme.color.error._400,
                },
            }
        case 'disabled':
            return {
                buttonStyle: {
                    ...baseButtonStyle,
                    borderColor: theme.color.neutral._500,
                },
                labelStyle: {
                    ...baseLabelStyle,
                    color: theme.color.neutral._500,
                },
            }
    }
}

const ThemedButton: React.FC<ThemedButtonProps> = ({
    labelStyle,
    label,
    buttonStyle,
    children,
    onPressIn,
    opacity = 1,
    onPressOut,
    variant = 'primary',
    iconName = undefined,
    iconSize = 20,
    iconStyle = undefined,
    icon = undefined,
    showActivityIndicator = false, // Default to false
    size = 'medium', // Default to medium
    ...rest
}) => {
    const animOpacity = useAnimatedValue(1)
    const theme = useButtonTheme(variant, size) // Pass size to useButtonTheme
    const handlePressIn = () => {
        animOpacity.setValue(0.4)
    }

    const handlePressOut = () => {
        Animated.timing(animOpacity, {
            toValue: 1,
            duration: 50,
            useNativeDriver: true,
        }).start()
    }

    return (
        <AnimatedPressable
            disabled={variant === 'disabled' ?? rest.disabled ?? showActivityIndicator} // Disable button if loading
            onPressIn={(event) => {
                handlePressIn()
                if (onPressIn) onPressIn(event)
            }}
            onPressOut={(event) => {
                handlePressOut()
                if (onPressOut) onPressOut(event)
            }}
            {...rest}
            style={StyleSheet.flatten([
                theme.buttonStyle,
                {
                    flexDirection: 'row',
                    columnGap: 8,
                    justifyContent: 'center',
                    alignItems: 'center',
                    opacity: animOpacity,
                },
                buttonStyle,
            ])}>
            {showActivityIndicator ? (
                <ActivityIndicator
                    size={iconSize ?? (size === 'small' ? 'small' : 'large')} // Adjust spinner size based on button size
                    color={theme.labelStyle.color}
                />
            ) : (
                <>
                    {!icon && iconName && (
                        <AntDesign
                            name={iconName}
                            size={iconSize}
                            style={iconStyle}
                            color={theme.labelStyle.color}
                        />
                    )}
                    {icon}
                </>
            )}
            {label && <TText style={[theme.labelStyle, labelStyle]}>{label}</TText>}
        </AnimatedPressable>
    )
}

export default ThemedButton;
