import Live
from typing import Tuple
from .handler import AbletonOSCHandler

class ApplicationHandler(AbletonOSCHandler):
    def init_api(self):
        #--------------------------------------------------------------------------------
        # Generic callbacks
        #--------------------------------------------------------------------------------
        def get_version(_) -> Tuple:
            application = Live.Application.get_application()
            return application.get_major_version(), application.get_minor_version()
        self.osc_server.add_handler("/live/application/get/version", get_version)
        self.osc_server.send("/live/startup")

        def get_average_process_usage(_) -> Tuple:
            application = Live.Application.get_application()
            return application.average_process_usage,
        self.osc_server.add_handler("/live/application/get/average_process_usage", get_average_process_usage)
        self.osc_server.send("/live/application/get/average_process_usage")

        #--------------------------------------------------------------------------------
        # Live's own dialogs (e.g. "Save changes?" when opening another set). A test that
        # triggers one through the UI reads it here and answers it by button index.
        #--------------------------------------------------------------------------------
        def get_open_dialog_count(_) -> Tuple:
            return Live.Application.get_application().open_dialog_count,
        self.osc_server.add_handler("/live/application/get/open_dialog_count", get_open_dialog_count)

        def get_current_dialog_message(_) -> Tuple:
            return Live.Application.get_application().current_dialog_message,
        self.osc_server.add_handler("/live/application/get/current_dialog_message", get_current_dialog_message)

        def get_current_dialog_button_count(_) -> Tuple:
            return Live.Application.get_application().current_dialog_button_count,
        self.osc_server.add_handler("/live/application/get/current_dialog_button_count", get_current_dialog_button_count)

        def press_current_dialog_button(params) -> None:
            Live.Application.get_application().press_current_dialog_button(int(params[0]))
        self.osc_server.add_handler("/live/application/press_current_dialog_button", press_current_dialog_button)
