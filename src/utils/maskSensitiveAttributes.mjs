/**
 * @file Utility functions for masking sensitive attributes in Terraform state.
 */

/**
 * Replaces the values of instance attributes that are listed in sensitive_attributes with null.
 * @param {object} terraformState - The Terraform state object to mask.
 * @returns {object} - The modified Terraform state object.
 */
export default function maskSensitiveAttributes (terraformState) {
  terraformState.resources.forEach((resource) => {
    resource.instances.forEach((instance) => {
      instance.sensitive_attributes.forEach((sensitiveAttributes) => {
        for (const sensitiveAttribute of sensitiveAttributes) {
          const attribute = sensitiveAttribute.value
          instance.attributes[attribute] = null
        }
      })
    })
  })

  return terraformState
}
