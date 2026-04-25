#include <libusb.h>
#include <glib.h>

static int send_command (libusb_device_handle *handle, const guint value, const guint index, guchar *data, gsize len)
{
    return libusb_control_transfer (handle, LIBUSB_ENDPOINT_IN | LIBUSB_REQUEST_TYPE_VENDOR | LIBUSB_RECIPIENT_DEVICE, 0x40, value, index, data, len, 0);
}

static libusb_device_handle *open_handle (libusb_context *ctx, const guint bus_number, const guint device_address)
{
    libusb_device **list;
    libusb_device *dev;
    libusb_device_handle *handle;
    unsigned int i;

    int success;
    int device_count;

    device_count = libusb_get_device_list (ctx, &list);
    if (device_count < 0) {
        return NULL;
    }

    dev = NULL;
    for (i = 0; i < device_count; i++) {
        if (libusb_get_bus_number (list[i]) != bus_number) {
            continue;
        }
        if (libusb_get_device_address (list[i]) != device_address) {
            continue;
        }
        dev = list[i];
        break;
    }

    if (dev == NULL) {
        libusb_free_device_list (list, 1);
        return NULL;
    }

    success = libusb_open (dev, &handle);
    libusb_free_device_list (list, 1);
    if (success < 0) {
        return NULL;
    }

    return handle;
}


static gchar *get_sysinfo_extended (libusb_device_handle *handle)
{
    GString *sysinfo_extended;
    guchar data[0x1000];
    unsigned int i;

    sysinfo_extended = g_string_sized_new (0x8000);

    for (i = 0; i < 0xffff; i++) {
        int bytes_read;
        bytes_read = send_command (handle, 0x02, i, data, sizeof (data));
        if (bytes_read < 0) {
            g_string_free (sysinfo_extended, TRUE);
            return NULL;
        }
        g_string_append_len (sysinfo_extended, (gchar*)data, bytes_read);
        if (bytes_read != sizeof (data)) {
            /* assume short reads mean "end of file" */
            break;
        }
    }

    if (sysinfo_extended->len == 0) {
        /* Nothing could be read from USB */
        g_string_free(sysinfo_extended, TRUE);
        return NULL;
    }

    return g_string_free (sysinfo_extended, FALSE);
}

gchar *itdb_read_sysinfo_extended_from_usb (guint bus_number, guint device_address)
{
    int success;
    libusb_context *ctx;
    libusb_device_handle *handle;
    gchar *sysinfo_extended;

    success = libusb_init (&ctx);
    if (success < 0) {
        return NULL;

    }

    handle = open_handle (ctx, bus_number, device_address);
    if (handle == NULL) {
        libusb_exit (ctx);
        return NULL;
    }

    sysinfo_extended = get_sysinfo_extended (handle);

    libusb_close (handle);
    libusb_exit (ctx);

    return sysinfo_extended;
}
