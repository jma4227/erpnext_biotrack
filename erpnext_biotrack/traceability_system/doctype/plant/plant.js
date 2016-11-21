// Copyright (c) 2016, Webonyx and contributors
// For license information, please see license.txt

frappe.provide("erpnext_biotrack.plant");
frappe.ui.form.on('Plant', {
    refresh: function (frm) {
        var is_new = frm.is_new();
        frm.toggle_display("qty", !is_new);
        frm.toggle_display("destroy_scheduled", !is_new);
        frm.toggle_display("harvest_scheduled", !is_new);
        frm.toggle_display("state", !is_new);
        frm.toggle_display("disabled", !is_new);
        frm.toggle_reqd("item_group", is_new);
        frm.toggle_reqd("item_code", is_new);

        erpnext_biotrack.plant.setup_actions(frm);

        function cal_remaining_time(d) {
            var expire_d = moment(d).add(72, "hours");
            var diff = moment(expire_d).diff(moment(), "hours");

            if (diff == 0) {
                diff = moment(expire_d).diff(moment(), "minutes");
                if (diff < 0) {
                    diff = 0
                } else {
                    diff += ' minutes'
                }
            } else {
                if (diff < 0) {
                    diff = 0;
                } else {
                    diff += ' hours'
                }
            }

            if (diff == 0) {
                diff = '72 hours remaining expired'
            } else {
                diff += ' remaining';
            }

            return diff
        }


        if (frm.doc.remove_scheduled) {
            if (frm.doc.disabled) {
                frm.dashboard.add_comment(
                    __("The Plant had been destroyed"),
                    true
                );
            } else {
                frm.dashboard.add_comment(
                    __("This Plant is scheduled for destruction. <strong>{0}</strong>", [cal_remaining_time(frm.doc.remove_time)]),
                    true
                );
            }

        }

        frm.fields_dict['item_code'].get_query = function (doc, cdt, cdn) {
            if (frm.doc.item_group) {
                return {
                    filters: {'item_group': frm.doc.item_group}
                }
            } else {
                return {
                    filters: {'item_group': ["in", frm.get_field('item_group').df.options.split("\n")]}
                }
            }
        };
    },
    bulk_add: function (frm) {
        frm.toggle_display("qty", frm.doc.bulk_add);
        frm.toggle_reqd("qty", frm.doc.bulk_add);
    }
});

$.extend(erpnext_biotrack.plant, {
    setup_actions: function (frm) {
        frm.page.clear_actions_menu();

        if (frm.is_new() || frm.doc.disabled || frm.doc.docstatus != 1) {
            return;
        }

        if (frm.doc.wet_weight && !frm.doc.dry_weight) {
            var $btn = frm.add_custom_button(__('Undo Harvest'), function () {
                $btn.prop('disabled', true);
                frappe.call({
                    doc: frm.doc,
                    method: 'harvest_undo',
                    callback: function (data) {
                        cur_frm.reload_doc();
                    }
                });
            })
        }

        if (!frm.doc.destroy_scheduled) {
            if (frm.doc.state == 'Growing') {
                if (!frm.doc.harvest_scheduled) {
                    frm.page.add_action_item(__('Schedule for Harvesting'), function () {
                        erpnext_biotrack.plant.harvest_schedule(frm);
                    });
                } else {
                    frm.page.add_action_item(__('Harvest'), function () {
                        erpnext_biotrack.plant.harvest_cure(frm);
                    });
                }


                frm.page.add_action_item(__('Convert to Mature Plant'), function () {
                    erpnext_biotrack.plant.move_to_inventory(frm);
                })
            } else if (frm.doc.state == 'Drying') {
                frm.page.add_action_item(__('Cure'), function () {
                    erpnext_biotrack.plant.harvest_cure(frm);
                });
            }

            if (frm.doc.harvest_scheduled) {
                if (frm.doc.state == 'Growing') {
                    frm.page.add_action_item(__("Undo Scheduled Harvest"), function () {
                        erpnext_biotrack.plant.harvest_schedule_undo(frm);
                    })
                }
            } else {

                frm.page.add_action_item(__("Schedule for Destruction"), function () {
                    erpnext_biotrack.plant.destroy_schedule(frm);
                });
            }

        } else {
            frm.add_custom_button('Undo Destruction Notification', function () {
                erpnext_biotrack.plant.destroy_schedule_undo(frm);
            });

            frm.add_custom_button('Override Destruction Notification', function () {
                erpnext_biotrack.plant.destroy_schedule(frm);
            });
        }
    },
    plant_new_undo: function (doc) {
        frappe.call({
            doc: doc,
            method: 'undo',
            callback: function (data) {
                window.history.back();
            }
        });
    },
    harvest_schedule: function (frm) {
        frappe.call({
            doc: frm.doc,
            method: 'harvest_schedule',
            callback: function (data) {
                cur_frm.reload_doc();
            }
        });
    },
    harvest_cure: function (frm) {
        var doc = frm.doc,
            fields = [
                {
                    fieldname: 'name', label: 'Plant Identifier', fieldtype: 'Data', read_only: 1, 'default': doc.name
                },
                {
                    fieldname: 'strain', label: 'Strain', fieldtype: 'Data', read_only: 1, 'default': doc.strain
                },
                {
                    fieldname: 'uom', label: 'UOM', fieldtype: 'Select', read_only: 1, options: ['Gram'], 'default': 'Gram'
                },
                {
                    fieldname: 'flower',
                    label: __('Flower {0} Weight', [doc.state == 'Growing' ? 'Wet' : 'Dry']),
                    fieldtype: 'Float',
                    reqd: 1
                },
                {
                    fieldname: 'other_material', label: 'Other Plant Material Weight', fieldtype: 'Float', 'default': 0.00
                },
                {
                    fieldname: 'waste', label: 'Waste Weight', fieldtype: 'Float', 'default': 0.00
                }
            ],
            dialog;

        fields.push(
            {
                fieldname: 'additional_collection', label: 'Additional Collections', fieldtype: 'Check'
            }
        );

        dialog = new frappe.ui.Dialog({
            title: __((doc.state == 'Growing' ? 'Harvest' : 'Cure') + ' Plant'),
            fields: fields,
            onhide: function () {
                cur_frm.reload_doc();
            }
        });

        dialog.set_primary_action(__('Submit'), function () {
            var values = dialog.get_values();
            if (!values) {
                return;
            }

            delete values['name'];
            delete values['strain'];
            delete values['uom']; // discard and use Gram by default

            frappe.call({
                doc: doc,
                method: (doc.state == 'Growing' ? 'harvest' : 'cure'),
                args: values,
                callback: function (data) {
                    dialog.hide();
                }
            });
        });

        dialog.show();
    },
    move_to_inventory: function (frm) {
        var doc = frm.doc,
            fields = [
                {
                    fieldname: 'name', label: 'Plant Identifier', fieldtype: 'Data', read_only: 1, default: doc.name
                },
                {
                    fieldname: 'strain', label: 'Strain', fieldtype: 'Data', read_only: 1, default: doc.strain
                }
            ],
            dialog;

        dialog = new frappe.ui.Dialog({
            title: __('Convert to Mature Plant'),
            fields: fields
        });

        dialog.set_primary_action(__('Move'), function () {
            frappe.call({
                doc: doc,
                method: 'convert_to_inventory',
                callback: function (data) {
                    dialog.hide();
                    frappe.set_route('List', 'Plant');
                }
            });
        });

        dialog.show();
    },
    destroy_schedule: function (frm) {
        var doc = frm.doc,
            fields = [
                {
                    fieldname: 'reason', label: __('Please choose a reason for scheduling this destruction'),
                    fieldtype: 'Select', options: [
                    'Other',
                    'Waste',
                    'Unhealthy or Died',
                    'Infestation',
                    'Product Return',
                    'Mistake',
                    'Spoilage',
                    'Quality Control'
                ]
                },
                {
                    fieldname: 'reason_txt', label: __('Reason Detail'),
                    fieldtype: 'Text'
                }
            ],
            dialog;

        if (doc.destroy_scheduled) {
            fields.push({
                fieldname: 'override', label: __('Reset Scheduled time'),
                fieldtype: 'Check'
            })
        }

        dialog = new frappe.ui.Dialog({
            title: __('Destruction Notification'),
            fields: fields
        });

        if (doc.destroy_scheduled) {
            dialog.get_field('override').set_input(1);
        }

        dialog.set_primary_action(__('Submit'), function () {
            var values = dialog.get_values();
            if (!values) {
                return;
            }

            if (!values.reason) {
                frappe.msgprint({
                    message: __('Please specify a reason'),
                    indicator: 'red',
                    title: 'Error'
                });

                return;
            }

            if (values.reason == 'Other' && !values.reason_txt) {
                frappe.msgprint({
                    message: __('Please input a reason detail'),
                    indicator: 'red',
                    title: 'Error'
                });

                return;
            }

            delete values['name'];
            frappe.call({
                doc: doc,
                method: 'destroy_schedule',
                args: values,
                callback: function (data) {
                    dialog.hide();
                    cur_frm.reload_doc();
                }
            });
        });

        dialog.show_message('This will initiate the 72 hour waiting period.');
        dialog.message.removeClass('small text-muted');
        dialog.show();
    },

    destroy_schedule_undo: function (frm) {
        frappe.confirm(
            'You are going to cancel destruction notification?',
            function () {
                frappe.call({
                    doc: frm.doc,
                    method: 'destroy_schedule_undo',
                    callback: function (data) {
                        cur_frm.reload_doc();
                    }
                });
            }
        );
    },
    harvest_schedule_undo: function (frm) {
        frappe.confirm(
            'Please confirm this action',
            function () {
                frappe.call({
                    doc: frm.doc,
                    method: 'harvest_schedule_undo',
                    callback: function (data) {
                        cur_frm.reload_doc();
                    }
                });
            }
        );
    },
});