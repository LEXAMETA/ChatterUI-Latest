// eslint/eslint-plugin-enforce-spacing-values.js

// REMOVE this line from the top of the file:
// const allowedValues = [0, 2, 4, 8, 12, 16, 24]

module.exports = {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Enforce border, padding, and margin values to be 0, 2, 4, 8, 12, or 16',
            category: 'Stylistic Issues',
            recommended: false,
        },
        schema: [], // no options
        messages: {
            // DIRECTLY EMBED THE VALUES here for the message string
            invalidValue: `The value '{{value}}' for '{{property}}' is not allowed. Use 0, 2, 4, 8, 12, 16, 24 instead.`,
        },
    },
    // Ensure 'create' is defined as a function, not a shorthand method
    create: function (context) {
        // RE-ADD allowedValues HERE, inside the 'create' function,
        // because it's used for the rule's logic
        const allowedValues = [0, 2, 4, 8, 12, 16, 24]

        const relevantProperties = [
            'margin',
            'marginTop',
            'marginBottom',
            'marginLeft',
            'marginRight',
            'marginHorizontal',
            'marginVertical',
            'padding',
            'paddingTop',
            'paddingBottom',
            'paddingLeft',
            'paddingRight',
            'paddingHorizontal',
            'paddingVertical',
            'borderRadius',
        ]

        return {
            // Ensure 'Property' is defined as a function, not a shorthand method
            Property: function (node) {
                if (relevantProperties.includes(node.key.name)) {
                    const value = node.value.value
                    if (typeof value === 'number' && !allowedValues.includes(value)) {
                        context.report({
                            node: node, // Use explicit 'node: node'
                            messageId: 'invalidValue',
                            data: {
                                value: value, // Use explicit 'value: value'
                                property: node.key.name,
                            },
                        })
                    }
                }
            },
        }
    },
}
