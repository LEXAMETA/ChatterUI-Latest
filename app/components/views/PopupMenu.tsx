import { AntDesign } from '@expo/vector-icons'
import { Theme } from '@lib/theme/ThemeManager'
import { useFocusEffect } from 'expo-router'
import React, { ReactNode, useRef, useState, useImperativeHandle } from 'react' // Import useImperativeHandle
import { StyleSheet, TouchableOpacity, Text, BackHandler, TextStyle } from 'react-native'
import {
    Menu,
    MenuOption,
    MenuOptions,
    MenuOptionsCustomStyle,
    MenuTrigger,
    renderers,
} from 'react-native-popup-menu'
import type { Menu as MenuType } from 'react-native-popup-menu'; // Import Menu type for ref

const { Popover } = renderers

// Define the type for the ref that *this* PopupMenu component exposes
export type PopupMenuHandle = {
    close: () => void;
    isOpen: () => boolean;
};

// No longer need MenuRef as a separate export, it's replaced by PopupMenuHandle
// export type MenuRef = React.MutableRefObject<{
//     close: () => void
//     isOpen: () => boolean
// } | null>

type PopupOptionProps = {
    label: string
    icon?: keyof typeof AntDesign.glyphMap
    onPress: (m: React.RefObject<PopupMenuHandle>) => void | Promise<void> // Changed type to PopupMenuHandle
    warning?: boolean
    menuRef: React.RefObject<PopupMenuHandle> // Changed type to PopupMenuHandle
}

type MenuOptionProp = Omit<PopupOptionProps, 'menuRef'>

type PopupMenuProps = {
    disabled?: boolean
    icon?: keyof typeof AntDesign.glyphMap
    iconSize?: number
    style?: TextStyle
    options: MenuOptionProp[]
    placement?: 'top' | 'right' | 'bottom' | 'left' | 'auto'
    children?: ReactNode
}

const PopupOption: React.FC<PopupOptionProps> = ({
    onPress,
    label,
    icon,
    menuRef, // This `menuRef` will now correctly be the `PopupMenuHandle` ref
    warning = false,
}) => {
    const styles = useStyles()
    const { color } = Theme.useTheme()
    const handleOnPress = async () => {
        await onPress(menuRef) // Pass the forwarded ref
    }

    return (
        <MenuOption>
            <TouchableOpacity style={styles.popupButton} onPress={handleOnPress}>
                {icon && (
                    <AntDesign
                        style={{ minWidth: 20 }}
                        name={icon}
                        size={18}
                        color={warning ? color.error._300 : color.text._100}
                    />
                )}
                <Text style={warning ? styles.optionLabelWarning : styles.optionLabel}>
                    {label}
                </Text>
            </TouchableOpacity>
        </MenuOption>
    )
}

// Use React.forwardRef to accept a ref from parent components
const PopupMenu = React.forwardRef<PopupMenuHandle, PopupMenuProps>(
    ({
        disabled,
        icon,
        iconSize = 26,
        style = {},
        options,
        children,
        placement = 'left',
    }, ref) => { // 'ref' is the forwarded ref from the parent
        const styles = useStyles()
        const { color } = Theme.useTheme()
        const menuStyle = useMenuStyle()
        const [showMenu, setShowMenu] = useState<boolean>(false)

        // Internal ref for the react-native-popup-menu Menu component
        const internalMenuRef = useRef<MenuType>(null); // Use MenuType from the library

        // Use useImperativeHandle to expose custom methods to the parent ref
        useImperativeHandle(ref, () => ({
            close: () => {
                internalMenuRef.current?.close();
            },
            isOpen: () => {
                return internalMenuRef.current?.isOpen() ?? false; // Default to false if not open
            },
        }));

        // Back handler to close menu on hardware back press
        const backAction = () => {
            if (!internalMenuRef.current || !internalMenuRef.current.isOpen()) return false
            internalMenuRef.current.close()
            return true
        }

        useFocusEffect(() => {
            // Ensure no duplicate listeners when component re-focuses quickly
            BackHandler.removeEventListener('hardwareBackPress', backAction)
            const handler = BackHandler.addEventListener('hardwareBackPress', backAction)
            return () => handler.remove()
        })

        return (
            <Menu
                ref={internalMenuRef} // Assign the internal ref to the Menu component
                onOpen={() => setShowMenu(true)}
                onClose={() => setShowMenu(false)}
                renderer={Popover}
                rendererProps={{
                    placement: placement,
                    anchorStyle: styles.anchor,
                    openAnimationDuration: 150,
                    closeAnimationDuration: 0,
                }}>
                <MenuTrigger disabled={disabled}>
                    {icon && (
                        <AntDesign
                            style={style}
                            color={showMenu ? color.text._500 : color.text._300}
                            name={icon}
                            size={iconSize}
                        />
                    )}
                    {children}
                </MenuTrigger>
                <MenuOptions customStyles={menuStyle}>
                    {options.map((item) => (
                        // Pass the forwarded ref down to PopupOption
                        <PopupOption {...item} key={item.label} menuRef={ref as React.RefObject<PopupMenuHandle>} icon={item.icon} />
                    ))}
                </MenuOptions>
            </Menu>
        )
    }
);

export default PopupMenu;

const useMenuStyle = (): MenuOptionsCustomStyle => {
    const { color, spacing, borderRadius } = Theme.useTheme()
    return {
        optionsContainer: {
            backgroundColor: color.neutral._200,
            padding: spacing.sm,
            borderRadius: borderRadius.l,
        },
        optionsWrapper: {
            backgroundColor: color.neutral._200,
        },
    }
}

const useStyles = () => {
    const { color, spacing } = Theme.useTheme()

    return StyleSheet.create({
        anchor: {
            backgroundColor: color.primary._300,
            padding: 4,
        },

        popupButton: {
            flexDirection: 'row',
            alignItems: 'center',
            columnGap: spacing.l,
            paddingVertical: spacing.l,
            paddingRight: spacing.xl2,
            paddingLeft: spacing.l,
            borderRadius: spacing.l,
        },

        headerButtonContainer: {
            flexDirection: 'row',
        },

        optionLabel: {
            color: color.text._100,
        },

        optionLabelWarning: {
            fontWeight: '500',
            color: color.error._300,
        },
    })
}
